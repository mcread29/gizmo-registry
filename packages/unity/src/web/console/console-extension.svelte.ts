import ConsolePanel from "./ConsolePanel.svelte";
import type {
  ExtensionContext,
  InspectorTabContribution,
  WebExtensionDefinition,
  WebExtensionRuntime,
} from "../host";
import type { ConsoleCounts, ConsoleEntry } from "./console-types";

const extensionId = "unity";
const consoleLimit = 500;

/** Unity's web implementation; Console is one of its internal capabilities. */
export const unityExtension: WebExtensionDefinition = {
  id: extensionId,
  apiVersion: 1,
  activate: (_descriptor, context) => new ConsoleExtensionRuntime(context),
};

export class ConsoleExtensionRuntime implements WebExtensionRuntime {
  entries = $state<ConsoleEntry[]>([]);
  counts = $state<ConsoleCounts>({ logs: 0, warnings: 0, errors: 0 });
  loading = $state(false);
  manualRefreshing = $state(false);
  error = $state<string>();
  readonly projectPath: string;
  readonly #context: ExtensionContext;
  readonly #timer: ReturnType<typeof setInterval>;
  #request?: Promise<void>;
  #revision?: string;
  #disposed = false;

  constructor(context: ExtensionContext) {
    this.#context = context;
    this.projectPath = context.projectPath;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), 1_000);
  }

  get inspectorTabs(): InspectorTabContribution[] {
    return [
      {
        id: `${extensionId}.console`,
        label: "Console",
        shortLabel: "Logs",
        badge: this.counts.errors,
        badgeTone: "danger",
        component: ConsolePanel,
        props: { runtime: this },
      },
    ];
  }

  refresh(manual = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#request) return this.#request;
    this.loading = true;
    this.manualRefreshing = manual;
    this.#request = this.#refreshSnapshot()
      .catch((error) => {
        this.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.loading = false;
        this.manualRefreshing = false;
        this.#request = undefined;
      });
    return this.#request;
  }

  async #refreshSnapshot(): Promise<void> {
    const probe = parseSnapshot(
      await this.#context.invoke("console.snapshot", { tail: 1 }),
    );
    if (!probe) return this.#markSnapshotError();
    if (this.#disposed) return;
    this.counts = probe.counts;
    if (probe.revision === this.#revision) return;
    const snapshot = parseSnapshot(
      await this.#context.invoke("console.snapshot", { tail: consoleLimit }),
    );
    if (!snapshot) return this.#markSnapshotError();
    if (this.#disposed) return;
    if (
      this.entries.length > 0 &&
      snapshot.entries.length === 0 &&
      consoleTotal(snapshot.counts) > 0
    ) {
      return this.#markSnapshotError();
    }
    this.#revision = snapshot.revision;
    this.entries = snapshot.entries.slice(-consoleLimit);
    this.counts = snapshot.counts;
    this.error = undefined;
  }

  #markSnapshotError(): void {
    this.error = "Console extension returned invalid data";
  }

  clearLocal(): void {
    this.entries = [];
    this.counts = { logs: 0, warnings: 0, errors: 0 };
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
  }
}

interface ConsoleSnapshot {
  revision?: string;
  counts: ConsoleCounts;
  entries: ConsoleEntry[];
}

function parseSnapshot(value: unknown): ConsoleSnapshot | undefined {
  const snapshot = record(value);
  const counts = consoleCounts(snapshot?.counts);
  if (
    snapshot?.state !== "ready" ||
    !counts ||
    !Array.isArray(snapshot.entries)
  ) {
    return;
  }
  return {
    ...(typeof snapshot.revision === "string"
      ? { revision: snapshot.revision }
      : {}),
    counts,
    entries: snapshot.entries
      .map(consoleEntry)
      .filter((entry): entry is ConsoleEntry => entry !== undefined),
  };
}

function consoleEntry(value: unknown): ConsoleEntry | undefined {
  const entry = record(value);
  if (!entry || typeof entry.message !== "string") return;
  const level =
    entry.level === "error" || entry.level === "warn" ? entry.level : "log";
  return {
    level,
    message: entry.message,
    ...(integer(entry.seq) === undefined ? {} : { seq: integer(entry.seq) }),
    ...(typeof entry.timestamp === "string"
      ? { timestamp: entry.timestamp }
      : {}),
    ...(typeof entry.stackTrace === "string" && entry.stackTrace
      ? { stackTrace: entry.stackTrace }
      : {}),
    ...(typeof entry.file === "string" && entry.file
      ? { file: entry.file }
      : {}),
    ...(integer(entry.line) === undefined ? {} : { line: integer(entry.line) }),
    ...(integer(entry.column) === undefined
      ? {}
      : { column: integer(entry.column) }),
  };
}

function consoleCounts(value: unknown): ConsoleCounts | undefined {
  const counts = record(value);
  const logs = integer(counts?.logs);
  const warnings = integer(counts?.warnings);
  const errors = integer(counts?.errors);
  return logs === undefined || warnings === undefined || errors === undefined
    ? undefined
    : { logs, warnings, errors };
}

function consoleTotal(counts: ConsoleCounts): number {
  return counts.logs + counts.warnings + counts.errors;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}
