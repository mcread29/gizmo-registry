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
import { join } from "node:path";
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

export interface SubagentStateFile {
  sessionId: string;
  updatedAt: number;
  subagents: SubagentStateEntry[];
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

/** Merged, newest-first view across every session that reported state. */
export function readMergedSubagentState(agentDir?: string): {
  updatedAt: number;
  subagents: SubagentStateEntry[];
} {
  const states = readAllSubagentStates(agentDir);
  const merged = states
    .flatMap((state) => state.subagents)
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
    Array.isArray(candidate.subagents)
  );
}

/**
 * Writes (or removes) one session's snapshot. Persistence is a UI affordance:
 * every failure path is swallowed rather than failing a tool call.
 */
export function writeSubagentState(
  sessionId: string,
  subagents: SubagentStateEntry[],
  agentDir?: string,
): void {
  const dir = subagentStateDir(agentDir);
  const path = stateFilePath(sessionId, agentDir);
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
