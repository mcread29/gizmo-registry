/**
 * The Unity Console as a view: one `log` block of the Editor's entries, with
 * the level and text filters the old browser panel had, driven by a poll of
 * the Console package's `snapshot` operation.
 */

import type {
  ActionEvent,
  ActionResult,
  Tone,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import type { UnityExtensionProvider } from "../unity-extension-provider";
import { consoleLine, matchesConsoleFilter } from "./console-log";
import { consoleTotal, parseSnapshot } from "./console-snapshot";
import type { ConsoleCounts, ConsoleEntry } from "./console-types";

const POLL_MS = 1_000;
const CONSOLE_LIMIT = 500;

type LevelFilter = "all" | "warnings" | "errors";

const levelSets: Record<LevelFilter, ConsoleEntry["level"][]> = {
  all: ["log", "warn", "error"],
  warnings: ["warn", "error"],
  errors: ["error"],
};

const tones: Record<ConsoleEntry["level"], Tone> = {
  log: "muted",
  warn: "warning",
  error: "error",
};

export interface ConsoleState {
  entries: ConsoleEntry[];
  counts: ConsoleCounts;
  level: LevelFilter;
  text: string;
  error?: string;
  loading: boolean;
}

export function renderConsoleView(state: ConsoleState): View {
  const visible = new Set(levelSets[state.level]);
  const shown = state.entries.filter((entry) =>
    matchesConsoleFilter(entry, visible, state.text),
  );
  return {
    title: "Unity Console",
    status: state.error ? "error" : state.loading ? "running" : "idle",
    ...(state.counts.errors
      ? { badge: state.counts.errors, badgeTone: "danger" as const }
      : {}),
    blocks: [
      {
        type: "keyValue",
        entries: [
          { label: "Logs", value: String(state.counts.logs) },
          {
            label: "Warnings",
            value: String(state.counts.warnings),
            ...(state.counts.warnings ? { tone: "warning" as const } : {}),
          },
          {
            label: "Errors",
            value: String(state.counts.errors),
            ...(state.counts.errors ? { tone: "error" as const } : {}),
          },
          {
            label: "Showing",
            value: `${shown.length} of ${state.entries.length}${
              state.text ? ` matching “${state.text}”` : ""
            }`,
          },
        ],
      },
      ...(state.error
        ? [{ type: "text" as const, text: state.error, tone: "error" as const }]
        : []),
      {
        type: "log",
        id: "console",
        follow: true,
        truncated: state.entries.length >= CONSOLE_LIMIT,
        lines: shown.map((entry) => ({
          text: consoleLine(entry),
          tone: tones[entry.level],
        })),
      },
    ],
    actions: [
      { id: "refresh", label: "Refresh" },
      {
        id: "level",
        label: `Level: ${state.level}`,
        input: {
          kind: "select",
          label: "Show entries",
          options: [
            { value: "all", label: "All" },
            { value: "warnings", label: "Warnings and errors" },
            { value: "errors", label: "Errors only" },
          ],
        },
      },
      {
        id: "filter",
        label: state.text ? `Filter: ${state.text}` : "Filter",
        input: {
          kind: "text",
          label: "Filter text",
          placeholder: "message or file",
          initialValue: state.text,
        },
      },
      { id: "clear", label: "Clear", tone: "danger" },
    ],
  };
}

export function openConsoleView(
  provider: UnityExtensionProvider,
  context: ViewContext,
): ViewHandle {
  const state: ConsoleState = {
    entries: [],
    counts: { logs: 0, warnings: 0, errors: 0 },
    level: "all",
    text: "",
    loading: true,
  };
  let disposed = false;
  let revision: string | undefined;
  let request: Promise<void> | undefined;
  const controller = new AbortController();

  const push = () => {
    if (!disposed) context.update(renderConsoleView(state));
  };

  const snapshot = async (tail: number) =>
    parseSnapshot(
      await provider.invoke(
        context.workspacePath,
        "unity",
        "console.snapshot",
        { tail },
        controller.signal,
      ),
    );

  async function read(): Promise<void> {
    // The probe is cheap; the full tail is only fetched when Unity says the
    // console changed, which is what keeps a one-second poll affordable.
    const probe = await snapshot(1);
    if (!probe) throw new Error("Console extension returned invalid data");
    if (disposed) return;
    state.counts = probe.counts;
    if (probe.revision === revision) return;
    const full = await snapshot(CONSOLE_LIMIT);
    if (!full) throw new Error("Console extension returned invalid data");
    if (disposed) return;
    if (
      state.entries.length > 0 &&
      full.entries.length === 0 &&
      consoleTotal(full.counts) > 0
    ) {
      throw new Error("Console extension returned invalid data");
    }
    revision = full.revision;
    state.entries = full.entries.slice(-CONSOLE_LIMIT);
    state.counts = full.counts;
    state.error = undefined;
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (request) return request;
    state.loading = true;
    request = read()
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        state.loading = false;
        request = undefined;
        push();
      });
    return request;
  }

  const timer = setInterval(() => void refresh(), POLL_MS);
  timer.unref?.();
  push();
  void refresh();

  async function action(event: ActionEvent): Promise<ActionResult> {
    if (event.cancelled) return { status: "rejected" };
    switch (event.actionId) {
      case "refresh":
        await refresh();
        return { status: "succeeded" };
      case "level":
        state.level =
          event.value === "errors" || event.value === "warnings"
            ? event.value
            : "all";
        push();
        return { status: "succeeded" };
      case "filter":
        state.text = event.value ?? "";
        push();
        return { status: "succeeded" };
      case "clear":
        // Local only, exactly as the panel's Clear was: Unity keeps its own log.
        state.entries = [];
        state.counts = { logs: 0, warnings: 0, errors: 0 };
        revision = undefined;
        push();
        return { status: "succeeded" };
      default:
        return { status: "failed", message: "Unknown action" };
    }
  }

  return {
    action,
    dispose() {
      disposed = true;
      clearInterval(timer);
      controller.abort();
    },
  };
}
