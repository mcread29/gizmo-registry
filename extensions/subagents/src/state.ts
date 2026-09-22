/**
 * Subagent state bridge between the Pi extension process and Gizmo's
 * agent-server process.
 *
 * The live SubagentManager only exists inside Pi, so the extension serializes
 * a bounded snapshot per session under `<agentDir>/subagents/state/`. The
 * agent-server side (see ./server/index.ts) reads those files to answer web
 * `list`/`invoke` calls. This module deliberately imports nothing from Pi so
 * both processes can share it.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readJsonFile,
  subagentStateDir,
  subagentThreadDir,
} from "../../../packages/orchestration/src/agent-dir.ts";

export type SubagentStateStatus = "running" | "done" | "error";

export interface SubagentStateEntry {
  id: string;
  title: string;
  status: SubagentStateStatus;
  model?: string;
  /** Ladder rung this run is on: "base" | "mid" | "strong". */
  tier?: string;
  /** How many rungs this run has climbed after failures. */
  escalations?: number;
  cwd: string;
  startedAt: number;
  settledAt?: number;
  error?: string;
  /** "12%/200k" style context utilization, when known. */
  context?: string;
  /** Bounded tail of the subagent's latest text output. */
  outputPreview?: string;
  /** Bounded head of the task prompt, for the list row. */
  promptPreview?: string;
  /** Thinking level of the current ladder rung, when known. */
  thinkingLevel?: string;
  /** Assistant messages produced so far. */
  turns?: number;
  /** Tool calls issued so far. */
  toolCalls?: number;
  /** Cumulative token usage across this run's assistant responses. */
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  /** Cumulative cost in USD, when the provider reports it. */
  cost?: number;
  /** Absolute path of the child's own session file (outside the workspace). */
  sessionFile?: string;
  /** Full task prompt, bounded; `promptPreview` stays the short form. */
  prompt?: string;
  /** Rendered ladder rungs, e.g. `base: openai/gpt-5 · low`. */
  ladder?: string[];
  /** Newest transcript activity, when known. */
  lastActivityAt?: number;
}

/**
 * One entry as served to the web UI. Subagent ids (`sa-1`, `sa-2`, ...) are
 * only unique within their parent session, so the merged view carries the
 * session and a globally unique key.
 */
export interface MergedSubagentEntry extends SubagentStateEntry {
  sessionId: string;
  /** `${sessionId}:${id}` — unique across every session in the snapshot. */
  key: string;
}

export interface SubagentStateFile {
  sessionId: string;
  updatedAt: number;
  subagents: SubagentStateEntry[];
  /** Parent session's working directory (the Gizmo workspace). */
  workspacePath?: string;
  /** Process that wrote the file; a dead pid means the session is gone. */
  pid?: number;
}

/** Which message a transcript entry came from. */
export type SubagentThreadRole = "user" | "assistant" | "toolResult" | "event";

/** What the entry holds: one content part, not a joined message. */
export type SubagentThreadKind =
  "text" | "thinking" | "toolCall" | "toolResult";

/**
 * One entry of a subagent's transcript, as served to the web UI. There is one
 * entry per content part, so reasoning, prose, tool calls and tool results
 * stay distinguishable instead of collapsing into a single text blob.
 */
export interface SubagentThreadMessage {
  role: SubagentThreadRole;
  kind: SubagentThreadKind;
  text: string;
  /** Tool name, for `toolCall`/`toolResult` entries. */
  name?: string;
  /** Message timestamp, when the source carried one. */
  at?: number;
}

/** One subagent's transcript, written by the Pi side and read by the server. */
export interface SubagentThreadFile {
  sessionId: string;
  id: string;
  updatedAt: number;
  messages: SubagentThreadMessage[];
}

export interface WriteSubagentStateOptions {
  agentDir?: string;
  workspacePath?: string;
  pid?: number;
}

export interface ReadMergedOptions {
  agentDir?: string;
  /** Only sessions rooted in this workspace; omit for every workspace. */
  workspacePath?: string;
  /** Only this parent session (the open thread); omit for every session. */
  sessionId?: string;
  /** Override for tests; defaults to a real liveness probe. */
  isProcessAlive?: (pid: number) => boolean;
}

const OUTPUT_PREVIEW_BYTES = 2_048;
const PROMPT_PREVIEW_LENGTH = 240;
/** Full prompt kept in the snapshot, so the panel can show the whole task. */
export const PROMPT_LIMIT = 4_096;
/** Entries kept per transcript; the newest survive. */
const THREAD_MESSAGE_LIMIT = 300;
const THREAD_TEXT_LIMIT = 8_000;

export function stateFilePath(sessionId: string, agentDir?: string): string {
  return join(subagentStateDir(agentDir), `${sessionId}.json`);
}

/** Reads one session's state file, or undefined when absent/corrupt. */
export function readSubagentState(
  sessionId: string,
  agentDir?: string,
): SubagentStateFile | undefined {
  const value = readJsonFile(stateFilePath(sessionId, agentDir));
  if (!isStateFile(value)) return undefined;
  return value;
}

/** Reads every session's state file that still parses. */
export function readAllSubagentStates(agentDir?: string): SubagentStateFile[] {
  const dir = subagentStateDir(agentDir);
  const states: SubagentStateFile[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return states;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const value = readJsonFile(join(dir, name));
    if (isStateFile(value)) states.push(value);
  }
  return states.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Case-insensitive on Windows, where the same workspace can be spelled two ways. */
export function sameWorkspace(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = resolve(value).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

/**
 * Merged, newest-first view across every live session that reported state.
 *
 * A file whose writer process is gone belongs to a session that ended
 * without cleaning up (a crash, a killed server); it is dropped from the
 * view and removed from disk. Files that predate `pid` tracking are treated
 * the same way, since nothing can vouch for them.
 */
export function readMergedSubagentState(options: ReadMergedOptions = {}): {
  updatedAt: number;
  subagents: MergedSubagentEntry[];
} {
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const states = readAllSubagentStates(options.agentDir).filter((state) => {
    if (state.pid === undefined || !isAlive(state.pid)) {
      try {
        rmSync(stateFilePath(state.sessionId, options.agentDir), {
          force: true,
        });
      } catch {
        // Best-effort cleanup.
      }
      return false;
    }
    if (
      options.sessionId !== undefined &&
      state.sessionId !== options.sessionId
    )
      return false;
    if (options.workspacePath === undefined) return true;
    // Legacy files carry no workspace; keep them visible rather than hide
    // work the user knows is running.
    if (state.workspacePath === undefined) return true;
    return sameWorkspace(state.workspacePath, options.workspacePath);
  });
  const merged = states
    .flatMap((state) =>
      state.subagents.map((entry) => ({
        ...entry,
        sessionId: state.sessionId,
        key: `${state.sessionId}:${entry.id}`,
      })),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const updatedAt = states.reduce(
    (latest, state) => Math.max(latest, state.updatedAt),
    0,
  );
  return { updatedAt, subagents: merged };
}

function isStateFile(value: unknown): value is SubagentStateFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SubagentStateFile>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.subagents) &&
    (candidate.workspacePath === undefined ||
      typeof candidate.workspacePath === "string") &&
    (candidate.pid === undefined || typeof candidate.pid === "number")
  );
}

/**
 * Writes (or removes) one session's snapshot. Persistence is a UI affordance:
 * every failure path is swallowed rather than failing a tool call.
 */
export function writeSubagentState(
  sessionId: string,
  subagents: SubagentStateEntry[],
  options: WriteSubagentStateOptions = {},
): void {
  const dir = subagentStateDir(options.agentDir);
  const path = stateFilePath(sessionId, options.agentDir);
  if (subagents.length === 0) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best-effort cleanup.
    }
    return;
  }
  const payload: SubagentStateFile = {
    sessionId,
    updatedAt: Date.now(),
    subagents,
    ...(options.workspacePath !== undefined
      ? { workspacePath: options.workspacePath }
      : {}),
    pid: options.pid ?? process.pid,
  };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(payload), "utf8");
  } catch {
    // State persistence is a UI affordance, never a tool error.
  }
}

/**
 * Path of one subagent's transcript. Session id and subagent id are joined
 * with a character neither can contain, so both stay recoverable from a
 * filename during cleanup.
 */
export function threadFilePath(
  sessionId: string,
  id: string,
  agentDir?: string,
): string {
  return join(subagentThreadDir(agentDir), `${sessionId}__${id}.json`);
}

/**
 * Writes one subagent's transcript. Like the state snapshot, this is a UI
 * affordance: every failure is swallowed.
 */
export function writeSubagentThread(
  sessionId: string,
  id: string,
  messages: SubagentThreadMessage[],
  options: { agentDir?: string } = {},
): void {
  const dir = subagentThreadDir(options.agentDir);
  const kept = messages.slice(-THREAD_MESSAGE_LIMIT).map((message) => ({
    role: message.role,
    kind: message.kind,
    text:
      message.text.length > THREAD_TEXT_LIMIT
        ? `…${message.text.slice(-THREAD_TEXT_LIMIT)}`
        : message.text,
    ...(message.name !== undefined ? { name: message.name } : {}),
    ...(message.at !== undefined ? { at: message.at } : {}),
  }));
  const payload: SubagentThreadFile = {
    sessionId,
    id,
    updatedAt: Date.now(),
    messages: kept,
  };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      threadFilePath(sessionId, id, options.agentDir),
      JSON.stringify(payload),
      "utf8",
    );
  } catch {
    // Transcript persistence is a UI affordance, never a tool error.
  }
}

/** Reads one subagent's transcript, or undefined when absent/corrupt. */
export function readSubagentThread(
  sessionId: string,
  id: string,
  agentDir?: string,
): SubagentThreadFile | undefined {
  const value = readJsonFile(threadFilePath(sessionId, id, agentDir));
  if (!isThreadFile(value)) return undefined;
  return { ...value, messages: value.messages.map(normalizeThreadMessage) };
}

const THREAD_ROLES = new Set(["user", "assistant", "toolResult", "event"]);
const THREAD_KINDS = new Set(["text", "thinking", "toolCall", "toolResult"]);

/**
 * Accepts entries written before transcripts were structured, where a message
 * was a joined `{ role, text }` blob: those become plain `text` entries.
 */
function normalizeThreadMessage(value: unknown): SubagentThreadMessage {
  const raw = (value ?? {}) as Partial<SubagentThreadMessage>;
  const role =
    typeof raw.role === "string" && THREAD_ROLES.has(raw.role)
      ? (raw.role as SubagentThreadRole)
      : "event";
  const kind =
    typeof raw.kind === "string" && THREAD_KINDS.has(raw.kind)
      ? (raw.kind as SubagentThreadKind)
      : "text";
  return {
    role,
    kind,
    text: typeof raw.text === "string" ? raw.text : "",
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.at === "number" ? { at: raw.at } : {}),
  };
}

/** Drops every transcript belonging to one parent session. */
export function removeSubagentThreads(
  sessionId: string,
  agentDir?: string,
): void {
  const dir = subagentThreadDir(agentDir);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(`${sessionId}__`)) continue;
    try {
      rmSync(join(dir, name), { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

function isThreadFile(value: unknown): value is SubagentThreadFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SubagentThreadFile>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.messages)
  );
}

/** Truncates from the start so the tail (the newest output) survives. */
export function boundedTail(text: string, maxBytes = OUTPUT_PREVIEW_BYTES) {
  if (text.length <= maxBytes) return text;
  return `…${text.slice(text.length - maxBytes)}`;
}

/** Truncates from the end so the head (the task statement) survives. */
export function boundedHead(text: string, maxLength = PROMPT_PREVIEW_LENGTH) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}
