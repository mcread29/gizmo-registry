/**
 * Result cards for the subagent tools, as views the host renders. These
 * replace the Svelte component the extension used to ship: the same data,
 * expressed in the view protocol.
 */

import { gizmoView, type View } from "@gizmo/extension-api";

export interface SubagentResultEntry {
  id: string;
  title?: string;
  status?: string;
  output?: string;
  model?: string;
  elapsed?: string;
  cwd?: string;
}

function toneOf(status: string | undefined) {
  if (status === "error") return "error" as const;
  if (status === "done") return "success" as const;
  if (status === "running") return "info" as const;
  return "muted" as const;
}

export function spawnCard(entry: {
  id: string;
  title: string;
  model: string;
  cwd: string;
  promptPreview?: string;
}) {
  const view: View = {
    title: `Spawned ${entry.id}`,
    status: "running",
    blocks: [
      { type: "metric", label: "Subagent", value: entry.id, tone: "info" },
      {
        type: "keyValue",
        entries: [
          { label: "Title", value: entry.title },
          { label: "Model", value: entry.model },
          { label: "Working directory", value: entry.cwd },
          ...(entry.promptPreview
            ? [{ label: "Prompt", value: entry.promptPreview }]
            : []),
        ],
      },
    ],
  };
  return gizmoView(view);
}

/** `subagent_wait` and `subagent_cancel`: one section per subagent. */
export function resultsCard(
  title: string,
  entries: SubagentResultEntry[],
  options: { withOutput: boolean },
) {
  const view: View = {
    title,
    status: entries.some((entry) => entry.status === "error")
      ? "error"
      : "success",
    blocks: entries.length
      ? entries.map((entry) => ({
          type: "section" as const,
          title: `${entry.id} · ${entry.title ?? "subagent"}`,
          blocks: [
            {
              type: "text" as const,
              text: entry.status ?? "unknown",
              tone: toneOf(entry.status),
            },
            ...(options.withOutput && entry.output
              ? [{ type: "code" as const, code: entry.output }]
              : []),
          ],
        }))
      : [{ type: "text", text: "No subagents matched.", tone: "muted" }],
  };
  return gizmoView(view);
}

export function checkCard(entry: {
  id: string;
  title: string;
  status: string;
  turns: number;
  model?: string;
  output?: string;
  error?: string;
}) {
  const view: View = {
    title: `${entry.id} · ${entry.title}`,
    status:
      entry.status === "error"
        ? "error"
        : entry.status === "running"
          ? "running"
          : "success",
    blocks: [
      {
        type: "keyValue",
        entries: [
          { label: "Status", value: entry.status, tone: toneOf(entry.status) },
          { label: "Turns", value: String(entry.turns) },
          ...(entry.model ? [{ label: "Model", value: entry.model }] : []),
        ],
      },
      ...(entry.error
        ? [{ type: "text" as const, text: entry.error, tone: "error" as const }]
        : []),
      ...(entry.output
        ? [{ type: "code" as const, code: entry.output, label: "Output" }]
        : []),
    ],
  };
  return gizmoView(view);
}

export function listCard(entries: SubagentResultEntry[]) {
  const view: View = {
    title: "Subagents",
    blocks: [
      {
        type: "table",
        id: "subagents",
        empty: "No subagents.",
        columns: [
          { id: "id", label: "ID" },
          { id: "title", label: "Title" },
          { id: "status", label: "Status" },
          { id: "model", label: "Model" },
          { id: "elapsed", label: "Elapsed", align: "end" },
        ],
        rows: entries.map((entry) => ({
          id: entry.id,
          tone: toneOf(entry.status),
          cells: {
            id: entry.id,
            title: entry.title ?? "",
            status: entry.status ?? "unknown",
            model: entry.model ?? "",
            elapsed: entry.elapsed ?? "",
          },
        })),
      },
    ],
  };
  return gizmoView(view);
}
