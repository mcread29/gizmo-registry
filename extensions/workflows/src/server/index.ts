/**
 * Gizmo agent-server integration for the workflows extension.
 *
 * Loaded in the agent-server process (not Pi's), so it cannot see the live
 * RunController. Instead it reads the run artifacts the workflow tool already
 * persists under `<agentDir>/workflows/<runId>/` (workflow.json, result.json,
 * transcripts.json) and answers web `list`/`invoke` calls from them.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readJsonFile,
  workflowRunsDir,
} from "../../../../packages/orchestration/src/agent-dir.ts";

/** Mirrors Gizmo's `ExtensionDescriptor` without importing `@gizmo/protocol`. */
interface ExtensionDescriptor {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
  operations: Array<{
    id: string;
    mutates: boolean;
    requiresConfirmation: boolean;
  }>;
}

interface AgentUsageShape {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextTokens?: number;
  turns?: number;
}

interface AgentShape {
  index: number;
  label?: string;
  phase?: string;
  state?: string;
  model?: string;
  contextWindow?: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  preview?: string;
  usage?: AgentUsageShape;
}

interface WorkflowShape {
  runId?: string;
  sessionId?: string;
  cwd?: string;
  updatedAt?: number;
  name?: string;
  description?: string;
  background?: boolean;
  status?: string;
  startedAt?: number;
  finishedAt?: number;
  phases?: { title?: string; detail?: string }[];
  currentPhase?: string;
  agents?: AgentShape[];
  result?: unknown;
  resultArtifact?: string;
  transcriptArtifact?: string;
  error?: string;
}

interface TranscriptEntryShape {
  role?: string;
  text?: string;
  name?: string;
  isError?: boolean;
  timestamp?: number;
}

const OPERATIONS = [
  { id: "runs", mutates: false, requiresConfirmation: false },
  { id: "run", mutates: false, requiresConfirmation: false },
  { id: "transcript", mutates: false, requiresConfirmation: false },
] as const;

/** Run ids are `wf_` + hex from the tool; enforce that before path joins. */
const RUN_ID_PATTERN = /^wf_[A-Za-z0-9]+$/;
/**
 * A running workflow refreshes workflow.json every few seconds; one that has
 * gone this long without a heartbeat belongs to a Pi process that died.
 */
const STALE_RUN_MS = 60_000;
const TRANSCRIPT_MAX_ENTRIES = 400;
const TRANSCRIPT_TEXT_MAX = 8 * 1024;

function descriptor(): ExtensionDescriptor {
  return {
    id: "workflows",
    name: "Workflows",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: [],
    operations: OPERATIONS.map((operation) => ({ ...operation })),
  };
}

function runDir(runId: string, agentDir?: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid workflow run id: ${runId}`);
  }
  return join(workflowRunsDir(agentDir), runId);
}

function readWorkflow(runId: string, agentDir?: string): WorkflowShape {
  const value = readJsonFile(join(runDir(runId, agentDir), "workflow.json"));
  if (!isWorkflow(value)) {
    throw new Error(`Workflow run artifacts are unavailable: ${runId}`);
  }
  return value;
}

/** Case-insensitive on Windows, where the same workspace can be spelled two ways. */
function sameWorkspace(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = resolve(value).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

/**
 * A run still marked running whose heartbeat stopped is reported as aborted,
 * the way the Pi-side dashboard does; nothing will ever finish it.
 */
export function effectiveStatus(
  details: WorkflowShape,
  now = Date.now(),
): string | undefined {
  if (details.status !== "running") return details.status;
  const heartbeat = details.updatedAt ?? details.startedAt;
  if (heartbeat === undefined) return details.status;
  return now - heartbeat > STALE_RUN_MS ? "aborted" : details.status;
}

function withEffectiveStatus(details: WorkflowShape): WorkflowShape {
  const status = effectiveStatus(details);
  if (status === details.status) return details;
  return {
    ...details,
    status,
    error: details.error ?? "The session running this workflow ended.",
  };
}

function summarize(
  runId: string,
  details: WorkflowShape,
): Record<string, unknown> {
  const agents = details.agents ?? [];
  const settled = agents.filter((agent) => agent.state !== "running").length;
  return {
    runId,
    sessionId: details.sessionId,
    name: details.name,
    status: details.status,
    background: details.background,
    startedAt: details.startedAt,
    finishedAt: details.finishedAt,
    currentPhase: details.currentPhase,
    agentsTotal: agents.length,
    agentsSettled: settled,
    agentsFailed: agents.filter((agent) => agent.state === "error").length,
    error: details.error,
  };
}

function isWorkflow(value: unknown): value is WorkflowShape {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkflowShape>;
  return typeof candidate.runId === "string" && Array.isArray(candidate.agents);
}

export const gizmoExtension = {
  id: "workflows",
  name: "Workflows",
  async list() {
    return [descriptor()];
  },
  async invoke(
    workspacePath: string,
    extensionId: string,
    operationId: string,
    input: unknown,
    _signal?: AbortSignal,
    agentDir?: string,
  ): Promise<unknown> {
    if (extensionId !== "workflows") {
      throw new Error(`Extension is not installed: ${extensionId}`);
    }

    if (operationId === "runs") {
      return { runs: listRuns(workspacePath, input, agentDir) };
    }

    if (operationId === "run") {
      const runId = readInputString(input, "runId");
      const details = withEffectiveStatus(readWorkflow(runId, agentDir));
      // The compact artifact keeps a marker in place of the result; the
      // real value lives in result.json.
      let result = details.result;
      if (details.resultArtifact) {
        const stored = readJsonFile(
          join(runDir(runId, agentDir), details.resultArtifact),
        );
        if (stored !== undefined) result = stored;
      }
      return { ...details, result };
    }

    if (operationId === "transcript") {
      const payload = (
        typeof input === "object" && input !== null ? input : {}
      ) as { runId?: unknown; agent?: unknown };
      const runId =
        typeof payload.runId === "string" ? payload.runId : undefined;
      const agent =
        typeof payload.agent === "number" ? payload.agent : undefined;
      if (!runId || agent === undefined) {
        throw new Error("transcript requires runId and agent");
      }
      const transcripts = readJsonFile(
        join(runDir(runId), "transcripts.json"),
      ) as Record<string, unknown> | undefined;
      const entries = transcripts?.[String(agent)];
      if (!Array.isArray(entries)) {
        return { agent, entries: [] };
      }
      const bounded = (entries as TranscriptEntryShape[])
        .slice(-TRANSCRIPT_MAX_ENTRIES)
        .map((entry) => ({
          role: typeof entry.role === "string" ? entry.role : "event",
          name: typeof entry.name === "string" ? entry.name : undefined,
          isError: entry.isError === true,
          timestamp:
            typeof entry.timestamp === "number" ? entry.timestamp : undefined,
          text:
            typeof entry.text === "string"
              ? entry.text.slice(0, TRANSCRIPT_TEXT_MAX)
              : "",
        }));
      return { agent, entries: bounded };
    }

    throw new Error(
      `Extension workflows does not expose operation: ${operationId}`,
    );
  },
};

/**
 * Runs launched from the given thread in the given workspace, newest first.
 * The panel is per-thread: with no thread to scope to there is nothing to
 * show, rather than every run on the machine.
 */
export function listRuns(
  workspacePath: string,
  input: unknown,
  agentDir?: string,
): Record<string, unknown>[] {
  const payload = (
    typeof input === "object" && input !== null ? input : {}
  ) as { sessionId?: unknown };
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId
      ? payload.sessionId
      : undefined;
  if (!sessionId) return [];
  let names: string[] = [];
  try {
    names = readdirSync(workflowRunsDir(agentDir));
  } catch {
    return [];
  }
  const runs: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!RUN_ID_PATTERN.test(name)) continue;
    const value = readJsonFile(
      join(workflowRunsDir(agentDir), name, "workflow.json"),
    );
    if (!isWorkflow(value)) continue;
    if (value.sessionId !== sessionId) continue;
    // Runs that predate workspace tracking carry no cwd; the session match
    // already pins them to one thread.
    if (
      value.cwd !== undefined &&
      workspacePath &&
      !sameWorkspace(value.cwd, workspacePath)
    )
      continue;
    runs.push(summarize(name, withEffectiveStatus(value)));
  }
  runs.sort(
    (left, right) =>
      (Number(right.startedAt) || 0) - (Number(left.startedAt) || 0),
  );
  return runs;
}

function readInputString(input: unknown, key: string): string {
  const payload = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const value = payload[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
