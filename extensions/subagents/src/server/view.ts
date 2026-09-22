/**
 * The Subagents view: the live list of subagents for the open thread, with
 * the selected one's full detail — model, thinking level, tier ladder,
 * counters, prompt, output and structured transcript — below it. The agent-server process cannot see the
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

export type SubagentFilter = "all" | "running" | "finished";

const FILTERS: ReadonlyArray<{ value: SubagentFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "finished", label: "Finished" },
];

function isSubagentFilter(value: unknown): value is SubagentFilter {
  return FILTERS.some((option) => option.value === value);
}

function matchesFilter(sub: MergedSubagentEntry, filter: SubagentFilter) {
  if (filter === "all") return true;
  const running = sub.status === "running";
  return filter === "running" ? running : !running;
}

export interface SubagentsViewState {
  subagents: MergedSubagentEntry[];
  updatedAt: number;
  selectedKey?: string;
  /** Which rows the list shows; the summary counts always cover them all. */
  filter?: SubagentFilter;
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

const TRANSCRIPT_LIMIT = 150;
const TOOL_RESULT_LIMIT = 400;

function tierBadge(tier: string | undefined) {
  if (!tier) return undefined;
  const text = tier.slice(0, 1).toUpperCase();
  const tone = tier === "strong" ? ("warning" as const) : ("muted" as const);
  return { text, tone };
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function tokensValue(tokens: NonNullable<MergedSubagentEntry["tokens"]>) {
  const parts = [
    `${formatTokens(tokens.input)} in`,
    `${formatTokens(tokens.output)} out`,
  ];
  if (tokens.cacheRead) parts.push(`${formatTokens(tokens.cacheRead)} cache r`);
  if (tokens.cacheWrite)
    parts.push(`${formatTokens(tokens.cacheWrite)} cache w`);
  if (tokens.total) parts.push(`${formatTokens(tokens.total)} total`);
  return parts.join(" · ");
}

function truncate(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** One transcript entry as a block: kind decides tone and shape. */
function transcriptBlock(
  message: SubagentThreadMessage,
): View["blocks"][number] {
  if (message.kind === "thinking") {
    return { type: "text", text: `thinking · ${message.text}`, tone: "muted" };
  }
  if (message.kind === "toolCall") {
    const args = message.text ? ` ${message.text}` : "";
    return {
      type: "text",
      text: `[tool] ${message.name ?? "unknown"}${args}`,
      tone: "info",
    };
  }
  if (message.kind === "toolResult") {
    const name = message.name ? `${message.name}: ` : "";
    return {
      type: "text",
      text: `${name}${truncate(message.text, TOOL_RESULT_LIMIT)}`,
      tone: "muted",
    };
  }
  if (message.role === "assistant") {
    return { type: "markdown", markdown: message.text };
  }
  return { type: "text", text: `${message.role}: ${message.text}` };
}

function transcriptBlocks(
  transcript: SubagentThreadMessage[] | undefined,
): View["blocks"] {
  if (!transcript?.length) {
    return [
      { type: "text", text: "No transcript recorded yet.", tone: "muted" },
    ];
  }
  const shown = transcript.slice(-TRANSCRIPT_LIMIT);
  const omitted = transcript.length - shown.length;
  const blocks: View["blocks"] = [];
  if (omitted > 0) {
    blocks.push({
      type: "text",
      text: `${omitted} earlier ${omitted === 1 ? "entry" : "entries"} omitted.`,
      tone: "muted",
    });
  }
  blocks.push(...shown.map(transcriptBlock));
  return blocks;
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
        ...(sub.thinkingLevel
          ? [{ label: "Thinking level", value: sub.thinkingLevel }]
          : []),
        ...(sub.tier ? [{ label: "Tier", value: sub.tier }] : []),
        ...(sub.ladder?.length
          ? [{ label: "Ladder", value: sub.ladder.join("  →  ") }]
          : []),
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
        ...(sub.turns !== undefined
          ? [{ label: "Turns", value: String(sub.turns) }]
          : []),
        ...(sub.toolCalls !== undefined
          ? [{ label: "Tool calls", value: String(sub.toolCalls) }]
          : []),
        ...(sub.tokens
          ? [{ label: "Tokens", value: tokensValue(sub.tokens) }]
          : []),
        ...(sub.cost !== undefined
          ? [{ label: "Cost", value: `$${sub.cost.toFixed(4)}` }]
          : []),
        ...(sub.context ? [{ label: "Context", value: sub.context }] : []),
        { label: "Working directory", value: sub.cwd },
        { label: "Started", value: new Date(sub.startedAt).toLocaleString() },
        { label: "Elapsed", value: elapsed(sub) },
        ...(sub.sessionFile
          ? [{ label: "Session file", value: sub.sessionFile }]
          : []),
      ],
    },
  ];
  if (sub.prompt ?? sub.promptPreview) {
    blocks.push({
      type: "section",
      title: "Prompt",
      collapsed: true,
      blocks: [{ type: "code", code: sub.prompt ?? sub.promptPreview! }],
    });
  }
  if (sub.error) {
    blocks.push({ type: "text", text: sub.error, tone: "error" });
  }
  if (sub.outputPreview) {
    blocks.push({
      type: "section",
      title: "Latest output",
      blocks: [{ type: "markdown", markdown: sub.outputPreview }],
    });
  } else if (sub.status === "running") {
    blocks.push({ type: "text", text: "No output yet.", tone: "muted" });
  }
  blocks.push({
    type: "section",
    title: "Transcript",
    blocks: transcriptBlocks(transcript),
  });
  return blocks;
}

export function renderSubagentsView(state: SubagentsViewState): View {
  const running = state.subagents.filter(
    (sub) => sub.status === "running",
  ).length;
  const failed = state.subagents.filter((sub) => sub.status === "error").length;
  const done = state.subagents.length - running - failed;
  const cost = state.subagents.reduce((sum, sub) => sum + (sub.cost ?? 0), 0);
  const filter = state.filter ?? "all";
  const visible = state.subagents.filter((sub) => matchesFilter(sub, filter));
  const selected = state.subagents.find((sub) => sub.key === state.selectedKey);

  const blocks: View["blocks"] = [];
  if (state.error) {
    blocks.push({ type: "text", text: state.error, tone: "error" });
  }
  blocks.push({
    type: "keyValue",
    entries: [
      { label: "Running", value: String(running), tone: "info" },
      { label: "Done", value: String(done), tone: "success" },
      {
        label: "Failed",
        value: String(failed),
        tone: failed ? "error" : "muted",
      },
      { label: "Cost", value: `$${cost.toFixed(4)}` },
    ],
  });
  const list: View["blocks"][number] = {
    type: "list",
    id: "subagents",
    empty:
      filter === "all"
        ? "Spawned subagents appear here while the agent works."
        : `No ${filter} subagents.`,
    onSelect: "inspect",
    ...(state.selectedKey ? { selectedId: state.selectedKey } : {}),
    items: visible.map((sub) => {
      const badge = tierBadge(sub.tier);
      return {
        id: sub.key,
        label: `${sub.id} · ${sub.title}`,
        detail: [
          sub.status,
          sub.model,
          sub.thinkingLevel,
          sub.context,
          elapsed(sub),
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
        tone: toneOf(sub.status),
        ...(badge ? { badge } : {}),
        ...(sub.sessionFile
          ? { path: sub.sessionFile }
          : { actions: [] as string[] }),
      };
    }),
  };
  blocks.push(list);
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
      // Named by the list's `onSelect`, so the host runs it on a row click
      // and keeps it out of the action bar.
      {
        id: "inspect",
        label: "Show detail",
        selection: { blockId: "subagents", required: true },
      },
      { id: "refresh", label: "Refresh" },
      {
        id: "filter",
        label: `Show: ${FILTERS.find((option) => option.value === filter)?.label ?? "All"}`,
        input: { kind: "select", label: "Show", options: [...FILTERS] },
      },
      {
        id: "open-session-file",
        label: "Open session file",
        placement: "item",
        selection: { blockId: "subagents", required: true },
        intent: {
          kind: "openFile",
          target: { kind: "selection", blockId: "subagents" },
        },
      },
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
    const sub = state.subagents.find(
      (entry) => entry.key === state.selectedKey,
    );
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
    if (event.actionId === "filter") {
      if (!isSubagentFilter(event.value)) {
        return { status: "failed", message: "Unknown filter" };
      }
      state.filter = event.value;
      push();
      return { status: "succeeded" };
    }
    if (event.actionId === "inspect") {
      const key = event.selection?.itemId;
      if (!key) return { status: "failed", message: "No subagent selected" };
      state.selectedKey = key;
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
