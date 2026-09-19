/**
 * The workflow tool's result card, as a view the host renders. It replaces
 * the Svelte component the extension used to ship: phases, agents, and the
 * run's result, expressed in the view protocol.
 */

import { gizmoView, type View } from "@gizmo/extension-api";
import { formatElapsed, resultJson, type WorkflowDetails } from "./model.ts";

const RESULT_MAX = 4_000;
const PREVIEW_MAX = 200;

function toneOf(state: string) {
  if (state === "error") return "error" as const;
  if (state === "done") return "success" as const;
  if (state === "running") return "info" as const;
  return "muted" as const;
}

export function workflowView(details: WorkflowDetails): View {
  const agents = details.agents;
  const done = agents.filter((agent) => agent.state === "done").length;
  const failed = agents.filter((agent) => agent.state === "error").length;
  const blocks: View["blocks"] = [
    {
      type: "keyValue",
      entries: [
        {
          label: "Status",
          value: `${details.status}${details.background ? " · background" : ""}`,
          tone: toneOf(details.status === "completed" ? "done" : details.status),
        },
        {
          label: "Agents",
          value: `${done}/${agents.length}${failed ? ` · ${failed} failed` : ""}`,
        },
        {
          label: "Elapsed",
          value: formatElapsed(details.startedAt, details.finishedAt),
        },
        ...(details.currentPhase
          ? [{ label: "Phase", value: details.currentPhase }]
          : []),
      ],
    },
  ];
  if (details.description) {
    blocks.push({ type: "text", text: details.description, tone: "muted" });
  }
  if (details.error) {
    blocks.push({ type: "text", text: details.error, tone: "error" });
  }
  if (agents.length > 0) {
    blocks.push({
      type: "table",
      id: "agents",
      columns: [
        { id: "agent", label: "Agent" },
        { id: "phase", label: "Phase" },
        { id: "state", label: "State" },
        { id: "model", label: "Model" },
        { id: "elapsed", label: "Elapsed", align: "end" },
      ],
      rows: agents.map((agent) => ({
        id: String(agent.index),
        tone: toneOf(agent.state),
        cells: {
          agent: agent.label,
          phase: agent.phase ?? "",
          state: agent.state,
          model: agent.model ?? "",
          elapsed: formatElapsed(agent.startedAt, agent.finishedAt),
        },
      })),
    });
    const running = agents.filter(
      (agent) => agent.state === "running" && agent.preview,
    );
    if (running.length > 0) {
      blocks.push({
        type: "log",
        lines: running.map((agent) => ({
          text: `${agent.label}: ${agent.preview.slice(0, PREVIEW_MAX)}`,
        })),
      });
    }
  }
  if (details.result !== undefined) {
    const text = resultJson(details.result);
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

  return {
    title: details.name ?? details.runId,
    status:
      details.status === "running"
        ? "running"
        : details.status === "completed"
          ? failed
            ? "warning"
            : "success"
          : "error",
    blocks,
  };
}

export function workflowCard(details: WorkflowDetails) {
  return gizmoView(workflowView(details));
}
