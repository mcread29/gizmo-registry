/**
 * Gizmo agent-server integration for the workflows extension.
 *
 * Loaded in the agent-server process (not Pi's), so it cannot see the live
 * RunController. Instead it reads the run artifacts the workflow tool already
 * persists under `<agentDir>/workflows/<runId>/` (workflow.json, result.json,
 * transcripts.json) and answers web `list`/`invoke` calls from them.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
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
    _workspacePath: string,
    extensionId: string,
    operationId: string,
    input: unknown,
  ): Promise<unknown> {
    if (extensionId !== "workflows") {
      throw new Error(`Extension is not installed: ${extensionId}`);
    }

    if (operationId === "runs") {
      let names: string[] = [];
      try {
        names = readdirSync(workflowRunsDir());
      } catch {
        return { runs: [] };
      }
      const runs: Record<string, unknown>[] = [];
      for (const name of names) {
        if (!RUN_ID_PATTERN.test(name)) continue;
        const value = readJsonFile(
          join(workflowRunsDir(), name, "workflow.json"),
        );
        if (isWorkflow(value)) runs.push(summarize(name, value));
      }
      runs.sort(
        (left, right) =>
          (Number(right.startedAt) || 0) - (Number(left.startedAt) || 0),
      );
      return { runs };
    }

    if (operationId === "run") {
      const runId = readInputString(input, "runId");
      const details = readWorkflow(runId);
      // Rehydrate the stored result so the UI can show it verbatim.
      let result = details.result;
      if (details.resultArtifact === "result.json" && result === undefined) {
        result = readJsonFile(join(runDir(runId), "result.json"));
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
