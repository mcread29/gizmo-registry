/**
 * Gizmo integration for the Codex extension.
 *
 * Owns the usage snapshot: one poll of ChatGPT's Codex backend, shared by
 * the titlebar status item and the usage view. The browser never polls; the
 * view pushes an update whenever the snapshot changes.
 */

import {
  defineExtension,
  type ExtensionHost,
  type View,
  type ViewContext,
  type ViewHandle,
} from "@gizmo/extension-api";
import {
  formatDuration,
  usageTone,
  windowLabel,
  type CodexUsageSnapshot,
  type CodexUsageWindow,
} from "../usage.ts";
import { createUsageService } from "./usage-service.ts";

/** Limits move slowly, so once a minute is plenty. */
const POLL_MS = 60_000;

export interface UsageSource {
  getUsage(signal?: AbortSignal): Promise<CodexUsageSnapshot>;
}

let usageService: UsageSource = createUsageService();

/** Swaps the usage source; the tests use it to stay off the network. */
export function setUsageSource(source: UsageSource): void {
  usageService = source;
}

let snapshot: CodexUsageSnapshot | undefined;
let failure: string | undefined;
let updatedAt = 0;
let loading = true;
let host: ExtensionHost | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let statusLabel: string | undefined;
let inflight: Promise<void> | undefined;

const listeners = new Set<() => void>();

/** Highest consumption across the plan's windows; drives the status item. */
function worstUsedPercent(): number | undefined {
  const primary = snapshot?.primary?.usedPercent;
  const secondary = snapshot?.secondary?.usedPercent;
  if (primary === undefined && secondary === undefined) return undefined;
  return Math.max(primary ?? 0, secondary ?? 0);
}

function announce(): void {
  for (const listener of [...listeners]) listener();
  const worst = worstUsedPercent();
  const label = worst === undefined ? undefined : `Codex ${Math.round(worst)}%`;
  if (label !== statusLabel) {
    statusLabel = label;
    host?.uiChanged();
  }
}

function refresh(): Promise<void> {
  inflight ??= usageService
    .getUsage()
    .then((value) => {
      snapshot = value;
      failure = undefined;
      updatedAt = Date.now();
    })
    .catch((error: unknown) => {
      failure = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      loading = false;
      inflight = undefined;
      announce();
    });
  return inflight;
}

function startPolling(): void {
  if (timer) return;
  timer = setInterval(() => void refresh(), POLL_MS);
  timer.unref?.();
  void refresh();
}

function stopPolling(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

/** Nothing is watching: stop asking ChatGPT. */
function stopPollingIfIdle(): void {
  if (listeners.size === 0 && !host) stopPolling();
}

function windowBlocks(window: CodexUsageWindow): View["blocks"] {
  const used = Math.round(window.usedPercent);
  return [
    {
      type: "progress",
      value: Math.min(100, Math.max(0, window.usedPercent)),
      max: 100,
      label: `${windowLabel(window.windowSeconds)} window — ${used}% used · resets in ${formatDuration(window.resetAfterSeconds)}`,
      tone: usageTone(window.usedPercent) === "danger" ? "error" : "default",
    },
  ];
}

function limitSummary(window: CodexUsageWindow | null): string | undefined {
  if (!window) return undefined;
  return `${windowLabel(window.windowSeconds)} ${Math.round(window.usedPercent)}%`;
}

export function renderUsageView(showEmail: boolean): View {
  const blocks: View["blocks"] = [];
  if (failure) {
    blocks.push({ type: "text", text: failure, tone: "error" });
  } else if (!snapshot) {
    blocks.push({
      type: "text",
      text: loading
        ? "Loading… Codex usage and limits will appear here."
        : "No Codex usage yet.",
      tone: "muted",
    });
  } else {
    if (snapshot.limitReached) {
      blocks.push({
        type: "text",
        text: "Limit reached — Codex pauses requests until the window resets.",
        tone: "error",
      });
    }
    const windows = [snapshot.primary, snapshot.secondary].filter(
      (window): window is CodexUsageWindow => window !== null,
    );
    for (const window of windows) blocks.push(...windowBlocks(window));
    if (snapshot.additional.length > 0) {
      blocks.push({
        type: "section",
        title: "Additional limits",
        blocks: [
          {
            type: "keyValue",
            entries: snapshot.additional.map((limit) => ({
              label: limit.name,
              value:
                [limitSummary(limit.primary), limitSummary(limit.secondary)]
                  .filter((part): part is string => part !== undefined)
                  .join(" · ") || "no usage tracked",
            })),
          },
        ],
      });
    }
    if (snapshot.credits?.unlimited) {
      blocks.push({ type: "text", text: "Unlimited credits" });
    } else if (snapshot.credits?.hasCredits) {
      blocks.push({
        type: "text",
        text: `Credit balance: ${snapshot.credits.balance}`,
      });
    }
    const footer: Array<{ label: string; value: string }> = [
      { label: "Plan", value: snapshot.planType ?? "unknown" },
      {
        label: "Updated",
        value: new Date(updatedAt).toLocaleTimeString(),
      },
    ];
    if (snapshot.email && showEmail) {
      footer.push({ label: "Account", value: snapshot.email });
    }
    blocks.push({ type: "keyValue", entries: footer });
  }

  const actions: NonNullable<View["actions"]> = [
    { id: "refresh", label: "Refresh" },
  ];
  if (snapshot?.email) {
    actions.push({
      id: "toggle-email",
      label: showEmail ? "Hide email" : "Show email",
    });
  }

  return {
    title: "Codex",
    status: failure
      ? "error"
      : snapshot
        ? snapshot.limitReached
          ? "warning"
          : "success"
        : "running",
    blocks,
    actions,
  };
}

function openUsageView(context: ViewContext): ViewHandle {
  let showEmail = false;
  const push = () => context.update(renderUsageView(showEmail));
  listeners.add(push);
  startPolling();
  push();
  void refresh();
  return {
    action(event) {
      if (event.cancelled) return { status: "rejected" as const };
      if (event.actionId === "toggle-email") {
        showEmail = !showEmail;
        push();
        return { status: "succeeded" as const };
      }
      if (event.actionId === "refresh") {
        void refresh();
        return { status: "succeeded" as const };
      }
      return { status: "failed" as const, message: "Unknown action" };
    },
    dispose() {
      listeners.delete(push);
      stopPollingIfIdle();
    },
  };
}

export const gizmoExtension = defineExtension({
  id: "codex",
  name: "Codex",
  activate(extensionHost) {
    host = extensionHost;
    startPolling();
  },
  views: {
    usage: { label: "Codex", open: openUsageView },
  },
  statusItems() {
    const worst = worstUsedPercent();
    if (worst === undefined) return [];
    return [
      {
        id: "codex.usage",
        label: `Codex ${Math.round(worst)}%`,
        tone: usageTone(worst),
        icon: "gauge",
        view: "usage",
      },
    ];
  },
  commands() {
    return [
      {
        id: "codex.usage",
        label: "Codex: Show usage",
        keywords: ["codex", "usage", "limits"],
        icon: "gauge",
        view: "usage",
      },
    ];
  },
  dispose() {
    stopPolling();
    listeners.clear();
    host = undefined;
  },
});
