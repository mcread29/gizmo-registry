/**
 * The Workflows view: the runs launched from the open thread, drilling into
 * one run's agents and one agent's transcript. It reads the run artifacts the
 * workflow tool persists, so it works from the agent-server process where the
 * live RunController is not visible.
 */

import type {
  ActionEvent,
  ActionResult,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import {
  listRuns,
  readRun,
  readTranscript,
  type AgentShape,
  type RunSummary,
  type TranscriptEntry,
  type WorkflowShape,
} from "./index.ts";

const POLL_MS = 2_000;
const RESULT_MAX = 4_000;

export interface WorkflowsViewState {
  runs: RunSummary[];
  run?: WorkflowShape;
  agentIndex?: number;
  transcript?: TranscriptEntry[];
  error?: string;
}

function elapsed(startedAt?: number, finishedAt?: number): string {
  if (!startedAt) return "—";
  const totalSeconds = Math.max(
    0,
    Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

function compact(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function usageText(agent: AgentShape): string {
  const usage = agent.usage;
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`${compact(usage.input)} in`);
  if (usage.output) parts.push(`${compact(usage.output)} out`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.join(" · ");
}

function toneOf(state: string | undefined) {
  if (state === "error") return "error" as const;
  if (state === "done" || state === "completed") return "success" as const;
  if (state === "running") return "info" as const;
  return "muted" as const;
}

function resultText(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text ?? "";
  } catch {
    return String(value);
  }
}

function agentLabel(agent: AgentShape): string {
  return agent.label ?? `agent-${agent.index}`;
}

function runBlocks(
  run: WorkflowShape,
  state: WorkflowsViewState,
): View["blocks"] {
  const agents = run.agents ?? [];
  const blocks: View["blocks"] = [
    {
      type: "keyValue",
      entries: [
        { label: "Run", value: run.runId ?? "" },
        {
          label: "Status",
          value: `${run.status ?? "unknown"}${run.background ? " · background" : ""}`,
          tone: toneOf(run.status),
        },
        {
          label: "Agents",
          value: `${agents.filter((agent) => agent.state === "done").length}/${agents.length}`,
        },
        { label: "Elapsed", value: elapsed(run.startedAt, run.finishedAt) },
        ...(run.currentPhase
          ? [{ label: "Phase", value: run.currentPhase }]
          : []),
      ],
    },
  ];
  if (run.description) {
    blocks.push({ type: "text", text: run.description, tone: "muted" });
  }
  if (run.error) blocks.push({ type: "text", text: run.error, tone: "error" });
  blocks.push({
    type: "table",
    id: "agents",
    empty: "This run has no agents.",
    ...(state.agentIndex !== undefined
      ? { selectedId: String(state.agentIndex) }
      : {}),
    columns: [
      { id: "agent", label: "Agent" },
      { id: "phase", label: "Phase" },
      { id: "state", label: "State" },
      { id: "model", label: "Model" },
      { id: "elapsed", label: "Elapsed", align: "end" },
      { id: "usage", label: "Usage" },
    ],
    rows: agents.map((agent) => ({
      id: String(agent.index),
      tone: toneOf(agent.state),
      cells: {
        agent: agentLabel(agent),
        phase: agent.phase ?? "",
        state: agent.state ?? "unknown",
        model: agent.model ?? "",
        elapsed: elapsed(agent.startedAt, agent.finishedAt),
        usage: usageText(agent),
      },
    })),
  });

  const agent = agents.find((entry) => entry.index === state.agentIndex);
  if (agent) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "heading", text: agentLabel(agent), level: 3 });
    if (agent.error) {
      blocks.push({ type: "text", text: agent.error, tone: "error" });
    }
    if (agent.preview && agent.state === "running") {
      blocks.push({ type: "text", text: agent.preview, tone: "muted" });
    }
    blocks.push(
      state.transcript?.length
        ? {
            type: "log",
            id: "transcript",
            lines: state.transcript.map((entry) => ({
              text: `${entry.role}${entry.name ? ` (${entry.name})` : ""}: ${entry.text}`,
              ...(entry.isError ? { tone: "error" as const } : {}),
              ...(entry.timestamp !== undefined
                ? { timestamp: entry.timestamp }
                : {}),
            })),
          }
        : { type: "text", text: "No transcript recorded.", tone: "muted" },
    );
  }

  if (run.result !== undefined) {
    const text = resultText(run.result);
    blocks.push({
      type: "section",
      title: "Result",
      blocks: [
        {
          type: "code",
          language: "json",
          code:
            text.length > RESULT_MAX
              ? `${text.slice(0, RESULT_MAX)}\n[truncated]`
              : text,
        },
      ],
    });
  }
  return blocks;
}

export function renderWorkflowsView(state: WorkflowsViewState): View {
  const running = state.runs.filter((run) => run.status === "running").length;
  const blocks: View["blocks"] = [];
  if (state.error) {
    blocks.push({ type: "text", text: state.error, tone: "error" });
  }

  if (state.run) {
    blocks.push(...runBlocks(state.run, state));
  } else {
    blocks.push({
      type: "keyValue",
      entries: [
        { label: "Running", value: String(running), tone: "info" },
        { label: "Total runs", value: String(state.runs.length) },
        {
          label: "Runs with failed agents",
          value: String(
            state.runs.filter((run) => run.agentsFailed > 0).length,
          ),
        },
      ],
    });
    blocks.push({
      type: "list",
      id: "runs",
      empty: "Workflow runs from this thread appear here.",
      items: state.runs.map((run) => ({
        id: run.runId,
        label: run.name ?? run.runId,
        tone: toneOf(run.status),
        detail: [
          run.status ?? "unknown",
          `${run.agentsSettled}/${run.agentsTotal} agents`,
          run.currentPhase,
          elapsed(run.startedAt, run.finishedAt),
          run.background ? "background" : undefined,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
      })),
    });
  }

  const actions: NonNullable<View["actions"]> = [];
  if (state.run) {
    actions.push({
      id: "open-agent",
      label: "Show transcript",
      selection: { blockId: "agents", required: true },
    });
    actions.push({ id: "back", label: "← All runs" });
  } else {
    actions.push({
      id: "open-run",
      label: "Open run",
      tone: "primary",
      selection: { blockId: "runs", required: true },
    });
  }
  actions.push({ id: "refresh", label: "Refresh" });

  return {
    title: state.run ? (state.run.name ?? state.run.runId ?? "Workflow") : "Workflows",
    status: state.error
      ? "error"
      : (state.run?.status ?? (running > 0 ? "running" : undefined)) === "running"
        ? "running"
        : "idle",
    ...(running > 0 ? { badge: running, badgeTone: "accent" as const } : {}),
    blocks,
    actions,
  };
}

export function openWorkflowsView(context: ViewContext): ViewHandle {
  const state: WorkflowsViewState = { runs: [] };
  let disposed = false;

  const push = () => {
    if (!disposed) context.update(renderWorkflowsView(state));
  };

  const loadTranscript = () => {
    const runId = state.run?.runId;
    if (!runId || state.agentIndex === undefined) {
      state.transcript = undefined;
      return;
    }
    state.transcript = readTranscript(runId, state.agentIndex);
  };

  const refresh = () => {
    try {
      state.runs = listRuns(context.workspacePath, {
        sessionId: context.sessionId,
      });
      if (state.run?.runId) {
        state.run = readRun(state.run.runId);
        loadTranscript();
      }
      state.error = undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    push();
  };

  const timer = setInterval(refresh, POLL_MS);
  timer.unref?.();
  refresh();

  function action(event: ActionEvent): ActionResult {
    if (event.cancelled) return { status: "rejected" };
    try {
      switch (event.actionId) {
        case "refresh":
          refresh();
          return { status: "succeeded" };
        case "open-run": {
          const runId = event.selection?.itemId;
          if (!runId) return { status: "failed", message: "No run selected" };
          state.run = readRun(runId);
          state.agentIndex = undefined;
          state.transcript = undefined;
          push();
          return { status: "succeeded" };
        }
        case "open-agent": {
          const index = Number(event.selection?.itemId);
          if (!Number.isInteger(index)) {
            return { status: "failed", message: "No agent selected" };
          }
          state.agentIndex = state.agentIndex === index ? undefined : index;
          loadTranscript();
          push();
          return { status: "succeeded" };
        }
        case "back":
          state.run = undefined;
          state.agentIndex = undefined;
          state.transcript = undefined;
          push();
          return { status: "succeeded" };
        default:
          return { status: "failed", message: "Unknown action" };
      }
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    action,
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}
