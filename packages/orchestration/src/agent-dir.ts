import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves Pi's agent directory the way Pi itself does, without importing
 * `@earendil-works/pi-coding-agent`: this module also runs inside the Gizmo
 * agent-server process, which must not load a second copy of Pi.
 *
 * The Pi process (which writes the state) uses the same resolution, so both
 * sides agree on where subagent state and workflow artifacts live.
 */
export function resolveAgentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  if (fromEnv) return expandHome(fromEnv);
  return join(homedir(), ".pi", "agent");
}

/** Pi expands a leading `~` in PI_CODING_AGENT_DIR; both sides must agree. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Directory where the subagents extension writes per-session state files. */
export function subagentStateDir(agentDir = resolveAgentDir()): string {
  return join(agentDir, "subagents", "state");
}

/** Directory where workflow runs persist their artifacts. */
export function workflowRunsDir(agentDir = resolveAgentDir()): string {
  return join(agentDir, "workflows");
}

/** Reads and parses a JSON file, returning undefined for any failure. */
export function readJsonFile(path: string): unknown {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
