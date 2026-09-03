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
} from "../../../packages/orchestration/src/agent-dir.ts";

export type SubagentStateStatus = "running" | "done" | "error";

export interface SubagentStateEntry {
  id: string;
  title: string;
  status: SubagentStateStatus;
  model?: string;
  cwd: string;
  startedAt: number;
  settledAt?: number;
  error?: string;
  /** "12%/200k" style context utilization, when known. */
  context?: string;
  /** Bounded tail of the subagent's latest text output. */
  outputPreview?: string;
  /** Bounded head of the task prompt, for context in the UI. */
  promptPreview?: string;
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

/** Truncates from the start so the tail (the newest output) survives. */
export function boundedTail(text: string, maxBytes = OUTPUT_PREVIEW_BYTES) {
  if (text.length <= maxBytes) return text;
  return `…${text.slice(text.length - maxBytes)}`;
}

export function boundedHead(text: string, maxLength = PROMPT_PREVIEW_LENGTH) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}
