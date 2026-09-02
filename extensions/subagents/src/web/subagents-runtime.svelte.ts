import type { Component } from "svelte";
import SubagentsPanel from "./SubagentsPanel.svelte";
import type {
  ExtensionContext,
  InspectorTabContribution,
  WebExtensionDefinition,
  WebExtensionRuntime,
} from "./types";

/** One subagent as reported by the agent-server snapshot operation. */
export interface SubagentEntry {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  model?: string;
  cwd: string;
  startedAt: number;
  settledAt?: number;
  error?: string;
  context?: string;
  outputPreview?: string;
  promptPreview?: string;
}

export interface Snapshot {
  updatedAt: number;
  subagents: SubagentEntry[];
}

/**
 * Subagents' web runtime: polls the server-side snapshot operation and feeds
 * the inspector tab. Polls fast while anything is running, slowly otherwise.
 */
export class SubagentsRuntime implements WebExtensionRuntime {
  subagents = $state<SubagentEntry[]>([]);
  loading = $state(true);
  error = $state<string>();
  updatedAt = $state(0);
  selectedId = $state<string>();

  readonly #context: ExtensionContext;
  readonly #timer: ReturnType<typeof setInterval>;
  #request?: Promise<void>;
  #lastFetch = 0;
  #disposed = false;

  constructor(context: ExtensionContext) {
    this.#context = context;
    void this.refresh();
    // Fast while anything is running, slow when idle; the tick itself is
    // cheap because refresh() throttles.
    this.#timer = setInterval(() => void this.refresh(), 1_000);
  }

  get pollMs(): number {
    return this.runningCount > 0 ? 1_000 : 5_000;
  }

  get inspectorTabs(): InspectorTabContribution[] {
    return [
      {
        id: "subagents.panel",
        label: "Subagents",
        badge: this.runningCount || undefined,
        badgeTone: "accent",
        component: SubagentsPanel as Component<any>,
        props: { runtime: this },
      },
    ];
  }

  get runningCount(): number {
    return this.subagents.filter((sub) => sub.status === "running").length;
  }

  get failedCount(): number {
    return this.subagents.filter((sub) => sub.status === "error").length;
  }

  get doneCount(): number {
    return this.subagents.filter((sub) => sub.status === "done").length;
  }

  selected(): SubagentEntry | undefined {
    return this.subagents.find((sub) => sub.id === this.selectedId);
  }

  refresh(manual = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#request) return this.#request;
    if (
      !manual &&
      Date.now() - this.#lastFetch < (this.runningCount > 0 ? 1_000 : 5_000)
    ) {
      return Promise.resolve();
    }
    this.#lastFetch = Date.now();
    this.loading = this.subagents.length === 0;
    this.#request = this.#context
      .invoke("snapshot")
      .then((value) => {
        if (this.#disposed) return;
        const snapshot = parseSnapshot(value);
        if (!snapshot) {
          this.error = "Subagents extension returned invalid data";
          return;
        }
        this.subagents = snapshot.subagents;
        this.updatedAt = snapshot.updatedAt;
        this.error = undefined;
        this.loading = false;
      })
      .catch((error) => {
        if (this.#disposed) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.loading = false;
      })
      .finally(() => {
        this.#request = undefined;
      });
    return this.#request;
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
  }
}

function parseSnapshot(value: unknown): Snapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as {
    updatedAt?: unknown;
    subagents?: unknown;
  };
  if (typeof candidate.updatedAt !== "number") return undefined;
  if (!Array.isArray(candidate.subagents)) return undefined;
  const subagents: SubagentEntry[] = [];
  for (const entry of candidate.subagents) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const raw = entry as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" ||
      (raw.status !== "running" &&
        raw.status !== "done" &&
        raw.status !== "error")
    ) {
      return undefined;
    }
    subagents.push({
      id: raw.id,
      title: raw.title,
      status: raw.status,
      model: typeof raw.model === "string" ? raw.model : undefined,
      cwd: typeof raw.cwd === "string" ? raw.cwd : "",
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
      settledAt: typeof raw.settledAt === "number" ? raw.settledAt : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
      context: typeof raw.context === "string" ? raw.context : undefined,
      outputPreview:
        typeof raw.outputPreview === "string" ? raw.outputPreview : undefined,
      promptPreview:
        typeof raw.promptPreview === "string" ? raw.promptPreview : undefined,
    });
  }
  return { updatedAt: candidate.updatedAt, subagents };
}

/** Lazy singleton so the definition object can be imported safely. */
let runtime: SubagentsRuntime | undefined;

export const subagentsExtension: WebExtensionDefinition = {
  id: "subagents",
  apiVersion: 1,
  activate: (_descriptor, context) => {
    runtime?.dispose();
    runtime = new SubagentsRuntime(context);
    return runtime;
  },
};
