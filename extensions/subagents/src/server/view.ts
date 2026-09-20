/**
 * The Subagents view: the live list of subagents for the open thread, with
 * one transcript expanded at a time. The agent-server process cannot see the
 * live SubagentManager, so this reads the state snapshots the Pi side writes
 * (see ../state.ts) — polling them once a second while anything runs, and
 * every five seconds when nothing does.
 */

import type {
  ActionEvent,
  ActionResult,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import {
  readMergedSubagentState,
  readSubagentThread,
  type MergedSubagentEntry,
  type SubagentThreadMessage,
} from "../state.ts";

const TICK_MS = 1_000;
const IDLE_TICKS = 5;

export interface SubagentsViewState {
  subagents: MergedSubagentEntry[];
  updatedAt: number;
  selectedKey?: string;
  transcript?: { key: string; messages: SubagentThreadMessage[] };
  error?: string;
}

function elapsed(sub: MergedSubagentEntry): string {
  const end = sub.settledAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.round((end - sub.startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

function toneOf(status: MergedSubagentEntry["status"]) {
  if (status === "error") return "error" as const;
  if (status === "done") return "success" as const;
  return "info" as const;
}

function detailBlocks(
  sub: MergedSubagentEntry,
  transcript: SubagentThreadMessage[] | undefined,
): View["blocks"] {
  const blocks: View["blocks"] = [
    {
      type: "keyValue",
      entries: [
        { label: "ID", value: sub.id },
        { label: "Status", value: sub.status, tone: toneOf(sub.status) },
        { label: "Model", value: sub.model ?? "unknown" },
        ...(sub.tier ? [{ label: "Tier", value: sub.tier }] : []),
        ...(sub.escalations
          ? [
              {
                label: "Escalated",
                value:
                  sub.escalations === 1
                    ? "once, after a failed tier"
                    : `${sub.escalations} times, after failed tiers`,
                tone: "warning" as const,
              },
            ]
          : []),
        { label: "Working directory", value: sub.cwd },
        { label: "Elapsed", value: elapsed(sub) },
        ...(sub.context ? [{ label: "Context", value: sub.context }] : []),
        ...(sub.promptPreview
          ? [{ label: "Prompt", value: sub.promptPreview }]
          : []),
      ],
    },
  ];
  if (sub.error) {
    blocks.push({ type: "text", text: sub.error, tone: "error" });
  }
  if (sub.outputPreview) {
    blocks.push({ type: "code", code: sub.outputPreview, label: "Output" });
  } else if (sub.status === "running") {
    blocks.push({ type: "text", text: "No output yet.", tone: "muted" });
  }
  blocks.push({
    type: "section",
    title: "Transcript",
    blocks: transcript?.length
      ? [
          {
            type: "log",
            id: "transcript",
            lines: transcript.map((message) => ({
              text: `${message.role}: ${message.text}`,
            })),
          },
        ]
      : [
          {
            type: "text",
            text: "No transcript recorded yet.",
            tone: "muted",
          },
        ],
  });
  return blocks;
}

export function renderSubagentsView(state: SubagentsViewState): View {
  const running = state.subagents.filter(
    (sub) => sub.status === "running",
  ).length;
  const failed = state.subagents.filter((sub) => sub.status === "error").length;
  const done = state.subagents.length - running - failed;
  const selected = state.subagents.find(
    (sub) => sub.key === state.selectedKey,
  );

  const blocks: View["blocks"] = [];
  if (state.error) {
    blocks.push({ type: "text", text: state.error, tone: "error" });
  }
  blocks.push({
    type: "keyValue",
    entries: [
      { label: "Running", value: String(running), tone: "info" },
      { label: "Done", value: String(done), tone: "success" },
      { label: "Failed", value: String(failed), tone: failed ? "error" : "muted" },
    ],
  });
  blocks.push({
    type: "list",
    id: "subagents",
    empty: "Spawned subagents appear here while the agent works.",
    ...(state.selectedKey ? { selectedId: state.selectedKey } : {}),
    items: state.subagents.map((sub) => ({
      id: sub.key,
      label: `${sub.id} · ${sub.title}`,
      detail: [sub.status, sub.context, elapsed(sub)]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone: toneOf(sub.status),
    })),
  });
  if (selected) {
    blocks.push({ type: "divider" });
    blocks.push(
      ...detailBlocks(
        selected,
        state.transcript?.key === selected.key
          ? state.transcript.messages
          : undefined,
      ),
    );
  }

  return {
    title: "Subagents",
    status: state.error ? "error" : running > 0 ? "running" : "idle",
    ...(running > 0 ? { badge: running, badgeTone: "accent" as const } : {}),
    blocks,
    actions: [
      {
        id: "inspect",
        label: "Show transcript",
        selection: { blockId: "subagents", required: true },
      },
      { id: "refresh", label: "Refresh" },
    ],
  };
}

export function openSubagentsView(context: ViewContext): ViewHandle {
  const state: SubagentsViewState = { subagents: [], updatedAt: 0 };
  let disposed = false;
  let ticks = 0;

  const push = () => {
    if (!disposed) context.update(renderSubagentsView(state));
  };

  const loadTranscript = () => {
    const sub = state.subagents.find((entry) => entry.key === state.selectedKey);
    if (!sub) {
      state.transcript = undefined;
      return;
    }
    const thread = readSubagentThread(sub.sessionId, sub.id);
    state.transcript = { key: sub.key, messages: thread?.messages ?? [] };
  };

  const refresh = () => {
    try {
      const snapshot = readMergedSubagentState({
        workspacePath: context.workspacePath,
        ...(context.sessionId !== undefined
          ? { sessionId: context.sessionId }
          : {}),
      });
      state.subagents = snapshot.subagents;
      state.updatedAt = snapshot.updatedAt;
      state.error = undefined;
      if (state.selectedKey) loadTranscript();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    push();
  };

  const timer = setInterval(() => {
    ticks += 1;
    const running = state.subagents.some((sub) => sub.status === "running");
    // A second while anything runs; a slower heartbeat when nothing does.
    if (running || ticks % IDLE_TICKS === 0) refresh();
  }, TICK_MS);
  timer.unref?.();

  refresh();

  function action(event: ActionEvent): ActionResult {
    if (event.cancelled) return { status: "rejected" };
    if (event.actionId === "refresh") {
      refresh();
      return { status: "succeeded" };
    }
    if (event.actionId === "inspect") {
      const key = event.selection?.itemId;
      if (!key) return { status: "failed", message: "No subagent selected" };
      state.selectedKey = state.selectedKey === key ? undefined : key;
      loadTranscript();
      push();
      return { status: "succeeded" };
    }
    return { status: "failed", message: "Unknown action" };
  }

  return {
    action,
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}
