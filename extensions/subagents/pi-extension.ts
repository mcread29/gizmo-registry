/**
 * Subagents - spawn background pi threads from the parent agent.
 *
 * Tools (for the parent LLM):
 * - subagent_spawn: fire-and-forget spawn (prompt, title, working_dir, tier,
 *   reasoning_effort). Max 4 running at once.
 * - subagent_wait: block until the listed subagents settle, return results.
 * - subagent_cancel: stop one or more running subagents.
 * - subagent_check: peek at a subagent's status and recent activity.
 * - subagent_list: list all subagents.
 *
 * Gizmo's "Subagents" inspector panel (see ./src/server/view.ts) is fed from
 * the bounded snapshots and structured transcripts this file writes to
 * `<agentDir>/subagents/` (see ./src/state.ts): model, thinking level, tier
 * ladder, turn/tool/token/cost counters, the task prompt, the latest output
 * and the per-part transcript.
 *
 * Unawaited subagents queue their result as a follow-up message when they
 * settle. `/subagents` opens a picker + full interactive takeover view, and
 * `/subagents tiers` configures the three model rungs a spawn draws from.
 *
 * Spawning is gated on those rungs existing on purpose: delegation is a cost
 * decision, so it gets made once, deliberately, instead of silently inheriting
 * whatever model the parent happens to be running.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum, type AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getMarkdownTheme,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  checkCard,
  listCard,
  resultsCard,
  spawnCard,
} from "./src/tool-cards.ts";
import { formatActivityStatus } from "../../packages/orchestration/src/activity-status.ts";
import { resolveStandaloneChildProjectTrust } from "../../packages/orchestration/src/child-session.ts";
import {
  contextPercent,
  formatContextUtilization,
} from "../../packages/orchestration/src/context-utilization.ts";
import {
  createDeclarativeView,
  supportsDeclarativeUi,
  type DeclarativeBlock,
} from "../../packages/orchestration/src/declarative-ui.ts";
import {
  activeModel,
  contextUsage,
  currentRung,
  finalOutput,
  formatElapsed,
  latestOutput,
  MAX_RUNNING,
  messageRole,
  type Subagent,
  type TierRung,
  SubagentManager,
} from "./src/manager.ts";
import { createDeferredResultDelivery } from "./src/result-delivery.ts";
import { gizmoExtension } from "./src/server/index.ts";
import {
  boundedHead,
  boundedTail,
  PROMPT_LIMIT,
  removeSubagentThreads,
  writeSubagentState,
  writeSubagentThread,
  type SubagentStateEntry,
  type SubagentThreadMessage,
} from "./src/state.ts";
import { openSubagentPicker } from "./src/takeover.ts";
import { EFFORTS, readTiers, TIERS } from "./src/tiers.ts";
import {
  configureTiers,
  resolveLadder,
  tiersGuidance,
} from "./src/tier-setup.ts";
import { createFailureSummarizer } from "./src/failure-handoff.ts";
import { messageText } from "./src/message-text.ts";

export { gizmoExtension };

const SUBAGENT_OUTPUT_MAX_BYTES = 24 * 1024;
const WAIT_OUTPUT_MAX_BYTES = 48 * 1024;
const WAIT_PER_AGENT_MAX_BYTES = 16 * 1024;

function describeSubagent(sub: Subagent): string {
  const model = activeModel(sub);
  const details = [
    model ? `${model.provider}/${model.id}` : "?",
    formatContextUtilization(contextUsage(sub)),
    formatElapsed(sub),
    sub.cwd,
  ].filter(Boolean);
  return `${sub.id} [${sub.status}] "${sub.title}" (${details.join(", ")})`;
}

/** Cumulative token/cost usage across a subagent's assistant responses. */
function usageTotals(sub: Subagent) {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    turns: 0,
    toolCalls: 0,
  };
  for (const message of sub.session.messages) {
    if (messageRole(message) !== "assistant") continue;
    const assistant = message as AssistantMessage;
    totals.turns += 1;
    totals.toolCalls += assistant.content.filter(
      (part) => part.type === "toolCall",
    ).length;
    const usage = assistant.usage;
    if (!usage) continue;
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
    totals.total += usage.totalTokens ?? 0;
    totals.cost += usage.cost?.total ?? 0;
  }
  return totals;
}

function describeRung(rung: TierRung): string {
  const model = `${rung.model.provider}/${rung.model.id}`;
  return `${rung.tier}: ${model}${rung.thinkingLevel ? ` · ${rung.thinkingLevel}` : ""}`;
}

function lastActivityAt(sub: Subagent): number | undefined {
  for (let i = sub.session.messages.length - 1; i >= 0; i--) {
    const at = (sub.session.messages[i] as { timestamp?: number }).timestamp;
    if (typeof at === "number") return at;
  }
  return undefined;
}

/** Bounded snapshot of one subagent for the Gizmo web state bridge. */
function toStateEntry(sub: Subagent): SubagentStateEntry {
  const model = activeModel(sub);
  const rung = currentRung(sub);
  const usage = usageTotals(sub);
  const activity = lastActivityAt(sub);
  const context = formatContextUtilization(contextUsage(sub));
  const hasTokens = usage.input + usage.output + usage.total > 0;
  return {
    id: sub.id,
    title: sub.title,
    status: sub.status,
    ...(model ? { model: `${model.provider}/${model.id}` } : {}),
    ...(rung ? { tier: rung.tier } : {}),
    ...(rung?.thinkingLevel
      ? { thinkingLevel: String(rung.thinkingLevel) }
      : {}),
    ...(sub.ladder.length > 0 ? { ladder: sub.ladder.map(describeRung) } : {}),
    ...(sub.escalations > 0 ? { escalations: sub.escalations } : {}),
    cwd: sub.cwd,
    startedAt: sub.createdAt,
    ...(sub.settledAt !== undefined ? { settledAt: sub.settledAt } : {}),
    ...(activity !== undefined ? { lastActivityAt: activity } : {}),
    ...(sub.errorText ? { error: sub.errorText } : {}),
    ...(context ? { context } : {}),
    ...(usage.turns > 0 ? { turns: usage.turns } : {}),
    ...(usage.toolCalls > 0 ? { toolCalls: usage.toolCalls } : {}),
    ...(hasTokens
      ? {
          tokens: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            total: usage.total,
          },
        }
      : {}),
    ...(usage.cost > 0 ? { cost: usage.cost } : {}),
    ...(sub.session.sessionFile
      ? { sessionFile: sub.session.sessionFile }
      : {}),
    ...(latestOutput(sub)
      ? { outputPreview: boundedTail(latestOutput(sub)) }
      : {}),
    ...(sub.prompt
      ? {
          promptPreview: boundedHead(sub.prompt),
          prompt: boundedHead(sub.prompt, PROMPT_LIMIT),
        }
      : {}),
  };
}

function truncatedOutput(
  sub: Subagent,
  maxBytes = SUBAGENT_OUTPUT_MAX_BYTES,
): string {
  const output = finalOutput(sub) || "(no output)";
  const truncation = truncateHead(output, {
    maxBytes: Math.min(maxBytes, DEFAULT_MAX_BYTES),
    maxLines: Math.min(600, DEFAULT_MAX_LINES),
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} shown. Full transcript in session file: ${sub.session.sessionFile ?? "?"}]`;
  }
  return text;
}

function buildResultText(sub: Subagent): string {
  const verb = sub.status === "error" ? "failed" : "finished";
  let text = `Subagent ${sub.id} "${sub.title}" ${verb}.`;
  if (sub.errorText) text += `\nError: ${sub.errorText}`;
  text += `\n\n${truncatedOutput(sub)}`;
  return text;
}

/** One-line summary of a tool call's arguments, for the transcript. */
function summarizeToolArguments(args: Record<string, unknown> | undefined) {
  if (!args) return "";
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.trim()) {
      const line = value.trim().split("\n")[0] ?? "";
      return line.length > 160 ? `${line.slice(0, 160)}…` : line;
    }
  }
  const keys = Object.keys(args);
  return keys.length > 0 ? keys.join(", ") : "";
}

function partText(part: { type?: string; text?: string }) {
  return typeof part.text === "string" ? part.text : "";
}

/**
 * Full transcript of one subagent, oldest first, for the web thread view:
 * one entry per content part so thinking, prose, tool calls and tool results
 * stay distinguishable in the panel.
 */
function threadMessages(sub: Subagent): SubagentThreadMessage[] {
  const entries: SubagentThreadMessage[] = [];
  for (const message of sub.session.messages) {
    const role = messageRole(message) ?? "event";
    const at = (message as { timestamp?: number }).timestamp;
    const stamp = typeof at === "number" ? { at } : {};
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      if (content.trim())
        entries.push({ role, kind: "text", text: content, ...stamp });
      continue;
    }
    if (!Array.isArray(content)) continue;
    const toolName = (message as { toolName?: string }).toolName;
    for (const part of content as Array<Record<string, any>>) {
      if (part.type === "text") {
        const text = partText(part);
        if (!text.trim()) continue;
        entries.push({
          role,
          kind: role === "toolResult" ? "toolResult" : "text",
          text,
          ...(role === "toolResult" && toolName ? { name: toolName } : {}),
          ...stamp,
        });
      } else if (part.type === "thinking") {
        const thinking = typeof part.thinking === "string" ? part.thinking : "";
        if (!thinking.trim()) continue;
        entries.push({ role, kind: "thinking", text: thinking, ...stamp });
      } else if (part.type === "toolCall") {
        entries.push({
          role,
          kind: "toolCall",
          text: summarizeToolArguments(part.arguments),
          name: typeof part.name === "string" ? part.name : "unknown",
          ...stamp,
        });
      }
    }
  }
  // While streaming, the newest text lives outside the message list.
  const live = latestOutput(sub);
  if (sub.session.isStreaming && live) {
    entries.push({ role: "assistant", kind: "text", text: live });
  }
  return entries;
}

function transcriptLines(sub: Subagent) {
  const lines = sub.session.messages.flatMap((message) => {
    const text = messageText(message);
    if (!text) return [];
    const role = (message as { role?: string }).role ?? "event";
    return text.split("\n").map((line) => ({
      text: `${role}: ${line.slice(0, 2_000)}`,
      tone: role === "toolResult" ? ("muted" as const) : undefined,
    }));
  });
  const live = latestOutput(sub);
  if (sub.session.isStreaming && live) {
    lines.push({ text: `assistant: ${live.slice(-2_000)}`, tone: undefined });
  }
  return { lines: lines.slice(-120), truncated: lines.length > 120 };
}

export default function (pi: ExtensionAPI) {
  const manager = new SubagentManager();
  const resultDelivery = createDeferredResultDelivery<Subagent>();
  let sessionContext: ExtensionContext | undefined;
  const summarizeFailure = createFailureSummarizer(() => sessionContext);
  let ui: ExtensionUIContext | undefined;
  let dashboardView: ReturnType<typeof createDeclarativeView> | undefined;
  let detailView: ReturnType<typeof createDeclarativeView> | undefined;
  let selectedSubagentId: string | undefined;
  let declarativeRefresh: ReturnType<typeof setInterval> | undefined;

  // --- Gizmo web state bridge -------------------------------------------
  // Snapshots are debounce-written so bursty child streams do not hammer disk.
  let stateWriteTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleStateWrite = () => {
    if (stateWriteTimer) return;
    stateWriteTimer = setTimeout(() => {
      stateWriteTimer = undefined;
      const sessionId = sessionContext?.sessionManager.getSessionId();
      if (!sessionId) return;
      writeSubagentState(sessionId, manager.list().map(toStateEntry), {
        workspacePath: sessionContext?.cwd,
      });
    }, 250);
  };

  // Transcripts dwarf the snapshot, so they get their own slower cadence and
  // are only rewritten when a thread actually changed.
  const THREAD_WRITE_MS = 2_000;
  let threadWriteTimer: ReturnType<typeof setTimeout> | undefined;
  const threadSignatures = new Map<string, string>();

  const writeThreads = () => {
    const sessionId = sessionContext?.sessionManager.getSessionId();
    if (!sessionId) return;
    for (const sub of manager.list()) {
      const messages = threadMessages(sub);
      const last = messages[messages.length - 1];
      const signature = `${messages.length}:${last?.text.length ?? 0}`;
      if (threadSignatures.get(sub.id) === signature) continue;
      threadSignatures.set(sub.id, signature);
      writeSubagentThread(sessionId, sub.id, messages);
    }
  };

  const scheduleThreadWrite = () => {
    if (threadWriteTimer) return;
    threadWriteTimer = setTimeout(() => {
      threadWriteTimer = undefined;
      writeThreads();
      // Sample again while anything is still streaming; settling rewrites the
      // last version through the change listener.
      if (manager.list().some((sub) => sub.status === "running")) {
        scheduleThreadWrite();
      }
    }, THREAD_WRITE_MS);
  };

  const dashboardBlocks = (): DeclarativeBlock[] => {
    const subs = manager.list();
    const running = subs.filter((sub) => sub.status === "running").length;
    const failed = subs.filter((sub) => sub.status === "error").length;
    const done = subs.length - running - failed;
    return [
      {
        type: "keyValue",
        entries: [
          {
            label: "Running",
            value: String(running),
            tone: running ? "info" : "muted",
          },
          {
            label: "Done",
            value: String(done),
            tone: done ? "success" : "muted",
          },
          {
            label: "Failed",
            value: String(failed),
            tone: failed ? "error" : "muted",
          },
        ],
      },
      {
        type: "table",
        id: "subagents",
        columns: [
          { id: "id", label: "ID" },
          { id: "title", label: "Title" },
          { id: "status", label: "Status" },
          { id: "model", label: "Model" },
          { id: "context", label: "Context", align: "end" },
          { id: "elapsed", label: "Elapsed", align: "end" },
          { id: "cwd", label: "Working directory" },
        ],
        rows: subs.map((sub) => {
          const model = activeModel(sub);
          return {
            id: sub.id,
            cells: {
              id: sub.id,
              title: sub.title,
              status: sub.status,
              model: model ? `${model.provider}/${model.id}` : "Unknown",
              context: formatContextUtilization(contextUsage(sub)) || "Unknown",
              elapsed: formatElapsed(sub),
              cwd: sub.cwd,
            },
            tone:
              sub.status === "error"
                ? "error"
                : sub.status === "done"
                  ? "success"
                  : "info",
          };
        }),
        ...(selectedSubagentId ? { selectedId: selectedSubagentId } : {}),
      },
      ...subs
        .filter((sub) => sub.errorText)
        .map((sub) => ({
          type: "text" as const,
          text: `${sub.id}: ${sub.errorText}`,
          tone: "error" as const,
        })),
    ];
  };

  const publishDashboard = () => {
    if (!dashboardView) return;
    const subs = manager.list();
    dashboardView.update({
      title: "Subagents",
      status: subs.some((sub) => sub.status === "running")
        ? "running"
        : subs.some((sub) => sub.status === "error")
          ? "error"
          : "idle",
      blocks: dashboardBlocks(),
      actions: [
        {
          id: "inspect",
          label: "Inspect",
          tone: "primary",
          selection: { blockId: "subagents", required: true },
        },
        {
          id: "cancel",
          label: "Cancel",
          tone: "danger",
          selection: { blockId: "subagents", required: true },
          confirm: {
            title: "Cancel subagent?",
            message:
              "Active model and tool work will be stopped. Partial transcripts remain on disk.",
          },
        },
        { id: "refresh", label: "Refresh" },
        { id: "close", label: "Close" },
      ],
    });
  };

  const publishDetail = () => {
    if (!detailView || !selectedSubagentId) return;
    const sub = manager.get(selectedSubagentId);
    if (!sub) {
      detailView.update({
        title: selectedSubagentId,
        status: "error",
        blocks: [
          {
            type: "text",
            text: "This subagent is no longer tracked.",
            tone: "error",
          },
        ],
        actions: [{ id: "back", label: "Back" }],
      });
      return;
    }
    const usage = contextUsage(sub);
    const percent = contextPercent(usage);
    const transcript = transcriptLines(sub);
    const blocks: DeclarativeBlock[] = [
      {
        type: "keyValue",
        entries: [
          { label: "ID", value: sub.id },
          { label: "Title", value: sub.title },
          {
            label: "Status",
            value: sub.status,
            tone:
              sub.status === "error"
                ? "error"
                : sub.status === "done"
                  ? "success"
                  : "info",
          },
          {
            label: "Model",
            value: activeModel(sub)
              ? `${activeModel(sub)!.provider}/${activeModel(sub)!.id}`
              : "Unknown",
          },
          { label: "Working directory", value: sub.cwd },
          { label: "Elapsed", value: formatElapsed(sub) },
        ],
      },
      ...(usage.contextWindow
        ? [
            {
              type: "progress" as const,
              value: percent ?? 0,
              max: 100,
              label: `Context ${formatContextUtilization(usage) || "usage unavailable"}`,
              tone:
                percent !== undefined && percent >= 85
                  ? ("warning" as const)
                  : ("info" as const),
            },
          ]
        : []),
      {
        type: "log",
        id: "transcript",
        lines: transcript.lines,
        truncated: transcript.truncated,
      },
      ...(sub.errorText
        ? [
            {
              type: "text" as const,
              text: sub.errorText,
              tone: "error" as const,
            },
          ]
        : []),
    ];
    detailView.update({
      title: `${sub.id} · ${sub.title}`,
      status:
        sub.status === "running"
          ? "running"
          : sub.status === "error"
            ? "error"
            : "success",
      blocks,
      actions: [
        {
          id: "send",
          label: sub.status === "running" ? "Steer" : "Send message",
          tone: "primary",
          input: {
            kind: "multiline",
            label: sub.status === "running" ? "Steering message" : "Message",
            required: true,
          },
        },
        {
          id: "cancel",
          label: "Cancel",
          tone: "danger",
          disabled: sub.status !== "running",
          confirm: {
            title: "Cancel subagent?",
            message: "Active model and tool work will be stopped.",
          },
        },
        { id: "back", label: "Back" },
      ],
    });
  };

  const publishDeclarativeViews = () => {
    publishDashboard();
    publishDetail();
  };

  const closeDeclarativeViews = () => {
    dashboardView?.close();
    detailView?.close();
    dashboardView = undefined;
    detailView = undefined;
    selectedSubagentId = undefined;
    if (declarativeRefresh) clearInterval(declarativeRefresh);
    declarativeRefresh = undefined;
  };

  const openDetail = (id: string) => {
    if (!sessionContext) return;
    selectedSubagentId = id;
    detailView?.close();
    detailView = createDeclarativeView(pi, sessionContext, {
      extensionId: "forker.subagents",
      viewId: `detail:${id}`,
    });
    detailView.onAction("send", ({ value, cancelled }) => {
      const sub = manager.get(id);
      if (!cancelled && value?.trim() && sub) manager.send(sub, value.trim());
      publishDeclarativeViews();
    });
    detailView.onAction("cancel", async ({ cancelled }) => {
      const sub = manager.get(id);
      if (!cancelled && sub) await manager.abort(sub);
      publishDeclarativeViews();
    });
    detailView.onAction("back", () => {
      detailView?.close();
      detailView = undefined;
      selectedSubagentId = undefined;
      publishDashboard();
    });
    publishDetail();
  };

  const openDeclarativeDashboard = (ctx: ExtensionContext) => {
    closeDeclarativeViews();
    sessionContext = ctx;
    dashboardView = createDeclarativeView(pi, ctx, {
      extensionId: "forker.subagents",
      viewId: "dashboard",
    });
    dashboardView.onAction("inspect", ({ selection }) => {
      if (selection) openDetail(selection.itemId);
    });
    dashboardView.onAction("cancel", async ({ selection, cancelled }) => {
      const sub = selection ? manager.get(selection.itemId) : undefined;
      if (!cancelled && sub) await manager.abort(sub);
      publishDeclarativeViews();
    });
    dashboardView.onAction("refresh", publishDeclarativeViews);
    dashboardView.onAction("close", closeDeclarativeViews);
    publishDashboard();
    declarativeRefresh = setInterval(publishDeclarativeViews, 500);
  };

  const updateStatus = () => {
    if (!ui) return;
    const subs = manager.list();
    if (subs.length === 0) {
      ui.setStatus("subagents", undefined);
      return;
    }
    const running = subs.filter((sub) => sub.status === "running").length;
    const failed = subs.filter((sub) => sub.status === "error").length;
    const done = subs.length - running - failed;
    ui.setStatus(
      "subagents",
      formatActivityStatus(ui.theme, "subagents", { running, done, failed }),
    );
  };

  manager.addChangeListener(() => {
    updateStatus();
    publishDeclarativeViews();
    scheduleStateWrite();
    scheduleThreadWrite();
  });

  const deliverResult = (sub: Subagent) => {
    pi.sendMessage(
      {
        customType: "subagent-result",
        content: buildResultText(sub),
        display: true,
        details: { id: sub.id, title: sub.title, status: sub.status },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const flushResults = () => {
    for (const sub of resultDelivery.drain()) deliverResult(sub);
  };

  manager.onSettled = (sub, consumed) => {
    if (consumed) {
      resultDelivery.consume([sub.id]);
      return;
    }
    // Keep the result retractable while the parent is working. A later
    // subagent_wait can consume it before agent_settled flushes follow-ups.
    resultDelivery.defer(sub);
    if (sessionContext?.isIdle()) flushResults();
  };

  pi.on("session_start", (_event, ctx) => {
    sessionContext = ctx;
    if (ctx.hasUI) ui = ctx.ui;
    updateStatus();
  });

  pi.on("agent_settled", flushResults);

  pi.on("session_shutdown", async () => {
    closeDeclarativeViews();
    if (stateWriteTimer) clearTimeout(stateWriteTimer);
    stateWriteTimer = undefined;
    if (threadWriteTimer) clearTimeout(threadWriteTimer);
    threadWriteTimer = undefined;
    threadSignatures.clear();
    const sessionId = sessionContext?.sessionManager.getSessionId();
    if (sessionId) {
      writeSubagentState(sessionId, []);
      removeSubagentThreads(sessionId);
    }
    sessionContext = undefined;
    resultDelivery.clear();
    ui?.setStatus("subagents", undefined);
    await manager.disposeAll();
  });

  // --- Tools -------------------------------------------------------------

  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description: [
      "Spawn a background subagent: a fully autonomous, headless pi thread with its own context window, normal built-ins, and trust-appropriate extension tools/resources.",
      "Fire-and-forget: this returns immediately with an id. The subagent's final output is queued back to you as a message when it settles,",
      "or collect it explicitly with subagent_wait. Children cannot orchestrate more agents/workflows or ask the user, and cannot see this conversation, so the prompt must be self-contained.",
      `Max ${MAX_RUNNING} subagents can be running at once.`,
    ].join(" "),
    promptSnippet:
      "Spawn a background subagent (own context, normal tools/resources) for a self-contained task",
    promptGuidelines: [
      "Use subagent_spawn to delegate self-contained tasks that can run in the background; give it a complete, standalone prompt.",
      "After subagent_spawn, keep working; results arrive automatically. Only call subagent_wait when you cannot proceed without the result.",
    ],
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "Task prompt for the subagent. Must be self-contained: include all needed context, file paths, and what to report back.",
      }),
      title: Type.String({
        description: "Short human-readable title for this subagent",
      }),
      working_dir: Type.Optional(
        Type.String({
          description: "Working directory (default: current working directory)",
        }),
      ),
      tier: Type.Optional(
        StringEnum(TIERS, {
          description:
            "Tier to start on: base (default) for most breadth work, mid or strong only when you already know the task defeats the cheaper model. Failed runs climb one tier at a time.",
        }),
      ),
      reasoning_effort: Type.Optional(
        StringEnum(EFFORTS, {
          description:
            "Override the starting tier's effort for this run only; escalated tiers keep their configured effort.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const tiers = readTiers();
      if (!tiers) throw new Error(tiersGuidance());
      const ladder = resolveLadder(
        ctx,
        tiers,
        params.tier ?? "base",
        params.reasoning_effort,
      );

      const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }

      const title = params.title.trim().slice(0, 160) || "subagent";
      const sub = await manager.spawn({
        prompt: params.prompt,
        title,
        cwd,
        ladder,
        modelRegistry: ctx.modelRegistry,
        projectTrusted: resolveStandaloneChildProjectTrust({
          parentCwd: ctx.cwd,
          childCwd: cwd,
          parentTrusted: ctx.isProjectTrusted(),
        }),
        summarizeFailure,
      });

      const start = ladder[0]!;
      const climbs = ladder.slice(1).map((rung) => rung.tier);
      return {
        content: [
          {
            type: "text",
            text:
              `Spawned subagent ${sub.id} "${sub.title}" on the ${start.tier} tier (${start.model.provider}/${start.model.id}, ${cwd}).\n` +
              (climbs.length > 0
                ? `If that run fails it climbs to ${climbs.join(" → ")}.\n`
                : "It has no tier left to climb to; a failure is final.\n") +
              `It runs in the background. Its result will be delivered to you when it finishes, ` +
              `or use subagent_wait(ids: ["${sub.id}"]) to block for it, subagent_cancel to stop it, subagent_check to peek, subagent_list to see all.`,
          },
        ],
        details: spawnCard({
          id: sub.id,
          title: sub.title,
          cwd,
          tier: start.tier,
          model: `${start.model.provider}/${start.model.id}`,
          escalation: climbs,
          promptPreview: boundedHead(params.prompt),
        }),
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description:
      "Block until all listed subagents have settled, then return their final outputs. Prefer letting results arrive automatically; use this only when you need a result before continuing.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        maxItems: 64,
        description: 'Subagent ids to wait for, e.g. ["sa-1", "sa-2"]',
      }),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const ids = [...new Set(params.ids)];
      if (ids.length === 0)
        throw new Error("Provide at least one subagent id.");
      const known = manager.list().map((sub) => sub.id);
      const unknown = ids.filter((id) => !manager.get(id));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown subagent id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }

      await manager.waitFor(ids, signal, (pending) => {
        onUpdate?.({
          content: [
            { type: "text", text: `Waiting for ${pending.join(", ")}...` },
          ],
          details: { pending },
        });
      });

      if (signal?.aborted)
        throw new Error("Wait aborted. Subagents keep running.");

      // Settlement may have happened before this wait began. Remove any
      // deferred automatic delivery now that the tool is returning the result.
      resultDelivery.consume(ids);

      const sections: string[] = [];
      let remainingBytes = WAIT_OUTPUT_MAX_BYTES;
      for (const id of ids) {
        const sub = manager.get(id);
        if (!sub) {
          sections.push(`## ${id}\n\n(no longer tracked)`);
          continue;
        }
        const verb = sub.status === "error" ? "failed" : "finished";
        let section = `## ${sub.id} "${sub.title}" ${verb}`;
        if (sub.errorText) section += `\nError: ${sub.errorText}`;
        const headerBytes = Buffer.byteLength(section, "utf8") + 2;
        const outputBudget = Math.max(
          512,
          Math.min(WAIT_PER_AGENT_MAX_BYTES, remainingBytes - headerBytes),
        );
        section += `\n\n${truncatedOutput(sub, outputBudget)}`;
        const sectionBytes = Buffer.byteLength(section, "utf8");
        if (sectionBytes > remainingBytes) {
          sections.push(
            `## ${sub.id} "${sub.title}"\n\n[omitted: total wait output limit reached]`,
          );
          break;
        }
        sections.push(section);
        remainingBytes -= sectionBytes;
      }

      const combined = sections.join("\n\n---\n\n");
      const bounded = truncateHead(combined, {
        maxBytes: WAIT_OUTPUT_MAX_BYTES - 128,
        maxLines: DEFAULT_MAX_LINES,
      });
      const text = bounded.truncated
        ? `${bounded.content}\n\n[wait output truncated at the total output limit]`
        : bounded.content;
      return {
        content: [{ type: "text", text }],
        // The text output stays in content; the card gets a bounded copy
        // so the result card can show what each agent said.
        details: resultsCard(
          "Subagent results",
          ids.map((id) => {
            const sub = manager.get(id);
            return {
              id,
              ...(sub ? { title: sub.title } : {}),
              ...(sub ? { status: sub.status } : {}),
              ...(sub ? { output: truncatedOutput(sub, 6 * 1024) } : {}),
            };
          }),
          { withOutput: true },
        ),
      };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description:
      "Cancel one or more running subagents. This aborts their active model/tool work but preserves their partial session transcripts on disk.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: 'Subagent ids to cancel, e.g. ["sa-1", "sa-2"]',
      }),
    }),
    async execute(_toolCallId, params) {
      const ids = [...new Set(params.ids)];
      if (ids.length === 0)
        throw new Error("Provide at least one subagent id.");

      const known = manager.list().map((sub) => sub.id);
      const unknown = ids.filter((id) => !manager.get(id));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown subagent id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }

      const running = ids
        .map((id) => manager.get(id))
        .filter((sub): sub is Subagent => sub?.status === "running");

      // Mark these results as consumed before aborting so cancellation does not
      // also enqueue duplicate automatic result messages into the parent.
      const waitForSettled = manager.waitFor(running.map((sub) => sub.id));
      await Promise.all(running.map((sub) => manager.abort(sub)));
      await waitForSettled;

      const lines = ids.map((id) => {
        const sub = manager.get(id)!;
        return running.includes(sub)
          ? `Cancelled ${sub.id} "${sub.title}".`
          : `${sub.id} "${sub.title}" was already ${sub.status}.`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: resultsCard(
          "Cancelled subagents",
          ids.map((id) => {
            const sub = manager.get(id)!;
            return { id, title: sub.title, status: sub.status };
          }),
          { withOutput: false },
        ),
      };
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description:
      "Peek at a subagent's status and recent activity without blocking. Does not consume its result.",
    parameters: Type.Object({
      id: Type.String({ description: "Subagent id" }),
    }),
    async execute(_toolCallId, params) {
      const sub = manager.get(params.id);
      if (!sub) {
        const known = manager.list().map((s) => s.id);
        throw new Error(
          `Unknown subagent id "${params.id}". Known: ${known.join(", ") || "none"}.`,
        );
      }

      const turns = sub.session.messages.filter(
        (msg) => (msg as { role?: string }).role === "assistant",
      ).length;
      let text = `${describeSubagent(sub)}\nTurns: ${turns}`;
      if (sub.errorText) text += `\nError: ${sub.errorText}`;

      const output = latestOutput(sub);
      if (output) {
        const preview = truncateHead(output, { maxBytes: 2048, maxLines: 20 });
        text += `\n\nLatest output:\n${preview.content}`;
        if (preview.truncated) text += "\n[...]";
      } else if (sub.status === "running") {
        text += "\n\n(no text output yet)";
      }

      return {
        content: [{ type: "text", text }],
        details: checkCard({
          id: sub.id,
          title: sub.title,
          status: sub.status,
          turns,
          model: activeModel(sub)
            ? `${activeModel(sub)!.provider}/${activeModel(sub)!.id}`
            : undefined,
          ...(latestOutput(sub)
            ? { output: boundedTail(latestOutput(sub)) }
            : {}),
          ...(sub.errorText ? { error: sub.errorText } : {}),
        }),
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: "List all subagents (running and finished) with their status.",
    parameters: Type.Object({}),
    async execute() {
      const subs = manager.list();
      const text =
        subs.length === 0
          ? "No subagents."
          : subs.map((sub) => describeSubagent(sub)).join("\n");
      return {
        content: [{ type: "text", text }],
        details: listCard(
          subs.map((sub) => ({
            id: sub.id,
            title: sub.title,
            status: sub.status,
            model: activeModel(sub)
              ? `${activeModel(sub)!.provider}/${activeModel(sub)!.id}`
              : undefined,
            elapsed: formatElapsed(sub),
            cwd: sub.cwd,
          })),
        ),
      };
    },
  });

  // --- Result message rendering ------------------------------------------

  pi.registerMessageRenderer(
    "subagent-result",
    (message, { expanded }, theme) => {
      const details = (message.details ?? {}) as {
        id?: string;
        title?: string;
        status?: string;
      };
      const failed = details.status === "error";
      const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`subagent ${details.id ?? "?"}`)) +
        theme.fg(
          "muted",
          ` · ${details.title ?? ""} · ${failed ? "failed" : "finished"}`,
        );

      const content =
        typeof message.content === "string" ? message.content : "";
      // Remove only the summary line. The following Error line (when present)
      // is part of the actual result and must remain visible.
      const body = content.split("\n").slice(1).join("\n").trim();

      if (expanded) {
        const md = new Markdown(`${body}`, 0, 0, getMarkdownTheme());
        const container = new Text(header, 0, 0);
        // Text can't hold children; render header + markdown via a simple approach:
        return {
          render: (width: number) => [
            ...container.render(width),
            ...md.render(width),
          ],
          invalidate: () => {
            container.invalidate();
            md.invalidate();
          },
        };
      }

      const previewLines = body.split("\n").slice(0, 8);
      let text = header;
      for (const line of previewLines)
        text += `\n${theme.fg("toolOutput", line)}`;
      if (body.split("\n").length > 8)
        text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
      return new Text(text, 0, 0);
    },
  );

  // --- Command ------------------------------------------------------------

  pi.registerCommand("subagents", {
    description:
      "List, inspect, and take over subagents; `tiers` configures the model ladder",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "tiers") {
        await configureTiers(ctx);
        return;
      }
      if (supportsDeclarativeUi(ctx)) {
        openDeclarativeDashboard(ctx);
        return;
      }
      if (ctx.mode !== "tui") {
        if (ctx.hasUI)
          ctx.ui.notify(
            "Subagent takeover is only available in the TUI or a declarative UI host",
            "error",
          );
        return;
      }
      if (manager.size() === 0) {
        ctx.ui.notify(
          "No subagents yet. The agent spawns them with subagent_spawn.",
          "info",
        );
        return;
      }
      await openSubagentPicker(ctx, manager);
    },
  });
}
