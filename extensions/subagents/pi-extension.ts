/**
 * Subagents - spawn background pi threads from the parent agent.
 *
 * Tools (for the parent LLM):
 * - subagent_spawn: fire-and-forget spawn (prompt, title, working_dir, model,
 *   provider, reasoning_effort). Max 4 running at once.
 * - subagent_wait: block until the listed subagents settle, return results.
 * - subagent_cancel: stop one or more running subagents.
 * - subagent_check: peek at a subagent's status and recent activity.
 * - subagent_list: list all subagents.
 *
 * Unawaited subagents queue their result as a follow-up message when they
 * settle. `/subagents` opens a picker + full interactive takeover view.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
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
  finalOutput,
  formatElapsed,
  latestOutput,
  MAX_RUNNING,
  type Subagent,
  SubagentManager,
  type ThinkingLevel,
} from "./src/manager.ts";
import { createDeferredResultDelivery } from "./src/result-delivery.ts";
import { gizmoExtension } from "./src/server/index.ts";
import {
  boundedHead,
  boundedTail,
  writeSubagentState,
  type SubagentStateEntry,
} from "./src/state.ts";
import { openSubagentPicker } from "./src/takeover.ts";

export { gizmoExtension };

const SUBAGENT_OUTPUT_MAX_BYTES = 24 * 1024;
const WAIT_OUTPUT_MAX_BYTES = 48 * 1024;
const WAIT_PER_AGENT_MAX_BYTES = 16 * 1024;

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

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

/** Bounded snapshot of one subagent for the Gizmo web state bridge. */
function toStateEntry(sub: Subagent): SubagentStateEntry {
  const model = activeModel(sub);
  return {
    id: sub.id,
    title: sub.title,
    status: sub.status,
    ...(model ? { model: `${model.provider}/${model.id}` } : {}),
    cwd: sub.cwd,
    startedAt: sub.createdAt,
    ...(sub.settledAt !== undefined ? { settledAt: sub.settledAt } : {}),
    ...(sub.errorText ? { error: sub.errorText } : {}),
    ...(formatContextUtilization(contextUsage(sub))
      ? { context: formatContextUtilization(contextUsage(sub)) }
      : {}),
    ...(latestOutput(sub)
      ? { outputPreview: boundedTail(latestOutput(sub)) }
      : {}),
    ...(sub.prompt ? { promptPreview: boundedHead(sub.prompt) } : {}),
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

function messageText(message: unknown) {
  const value = message as {
    role?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
        }>;
  };
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "thinking") return part.thinking ?? "";
      if (part.type === "toolCall") return `[tool] ${part.name ?? "unknown"}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
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

function resolveModel(
  ctx: ExtensionContext,
  provider: string | undefined,
  modelId: string | undefined,
): Model<any> {
  if (!provider && !modelId) {
    if (!ctx.model)
      throw new Error("No model is currently active to inherit from.");
    return ctx.model;
  }
  if (!modelId) {
    throw new Error(
      `Provider "${provider}" given without a model. Specify model too.`,
    );
  }
  const preferredProvider = provider ?? ctx.model?.provider;
  if (preferredProvider) {
    const found = ctx.modelRegistry.find(preferredProvider, modelId);
    if (found) return found;
  }
  if (provider) {
    throw new Error(`Unknown model "${provider}/${modelId}".`);
  }
  const matches = ctx.modelRegistry.getAll().filter((m) => m.id === modelId);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Model "${modelId}" exists in multiple providers (${matches.map((m) => m.provider).join(", ")}). Specify a provider.`,
    );
  }
  throw new Error(`Unknown model "${modelId}".`);
}

export default function (pi: ExtensionAPI) {
  const manager = new SubagentManager();
  const resultDelivery = createDeferredResultDelivery<Subagent>();
  let sessionContext: ExtensionContext | undefined;
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
      writeSubagentState(sessionId, manager.list().map(toStateEntry));
    }, 250);
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
    const sessionId = sessionContext?.sessionManager.getSessionId();
    if (sessionId) writeSubagentState(sessionId, []);
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
      model: Type.Optional(
        Type.String({
          description: "Model id (default: inherit the current model)",
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description: "Model provider (default: inherit the current provider)",
        }),
      ),
      reasoning_effort: Type.Optional(
        StringEnum(THINKING_LEVELS, {
          description: "Thinking level (default: inherit the current level)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const model = resolveModel(ctx, params.provider, params.model);
      const thinkingLevel = (params.reasoning_effort ??
        pi.getThinkingLevel()) as ThinkingLevel;

      const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }

      const title = params.title.trim().slice(0, 160) || "subagent";
      const sub = await manager.spawn({
        prompt: params.prompt,
        title,
        cwd,
        model,
        thinkingLevel,
        modelRegistry: ctx.modelRegistry,
        projectTrusted: resolveStandaloneChildProjectTrust({
          parentCwd: ctx.cwd,
          childCwd: cwd,
          parentTrusted: ctx.isProjectTrusted(),
        }),
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Spawned subagent ${sub.id} "${sub.title}" (${model.provider}/${model.id}, ${cwd}).\n` +
              `It runs in the background. Its result will be delivered to you when it finishes, ` +
              `or use subagent_wait(ids: ["${sub.id}"]) to block for it, subagent_cancel to stop it, subagent_check to peek, subagent_list to see all.`,
          },
        ],
        details: {
          id: sub.id,
          title: sub.title,
          cwd,
          model: `${model.provider}/${model.id}`,
          prompt_preview: boundedHead(params.prompt),
        },
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
        details: {
          results: ids.map((id) => {
            const sub = manager.get(id);
            return {
              id,
              ...(sub ? { title: sub.title } : {}),
              ...(sub ? { status: sub.status } : {}),
              // The text output stays in content; the card gets a bounded
              // copy so the web presentation can show what each agent said.
              ...(sub ? { output: truncatedOutput(sub, 6 * 1024) } : {}),
            };
          }),
        },
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
        details: {
          results: ids.map((id) => {
            const sub = manager.get(id)!;
            return { id, title: sub.title, status: sub.status };
          }),
        },
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
        details: {
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
        },
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
        details: {
          subagents: subs.map((sub) => ({
            id: sub.id,
            title: sub.title,
            status: sub.status,
            model: activeModel(sub)
              ? `${activeModel(sub)!.provider}/${activeModel(sub)!.id}`
              : undefined,
            elapsed: formatElapsed(sub),
            cwd: sub.cwd,
          })),
        },
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
    description: "List, inspect, and take over subagents",
    handler: async (_args, ctx) => {
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
