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
  /** Unique across sessions; `id` alone repeats (`sa-1` in every session). */
  key: string;
  sessionId?: string;
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

/** One message of a subagent transcript, oldest first. */
export interface ThreadMessage {
  role: string;
  text: string;
}

/** Transcript state for one subagent, keyed by the entry's unique key. */
export interface ThreadView {
  updatedAt: number;
  messages: ThreadMessage[];
  loading: boolean;
  error?: string;
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
  threads = $state<Record<string, ThreadView>>({});
  /** Threads the panel is showing; only these are refetched while polling. */
  readonly #openThreads = new Set<string>();

  readonly #context: ExtensionContext;
  readonly #timer: ReturnType<typeof setInterval>;
  #request?: Promise<void>;
  #lastFetch = 0;
  #disposed = false;
  /** Thread the current list belongs to; a switch refetches at once. */
  #sessionId: string | undefined;

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
    return this.subagents.find((sub) => sub.key === this.selectedId);
  }

  /** Fetches a subagent's transcript and keeps it fresh while it is open. */
  openThread(key: string): void {
    this.#openThreads.add(key);
    void this.loadThread(key);
  }

  closeThread(key: string): void {
    this.#openThreads.delete(key);
  }

  async loadThread(key: string): Promise<void> {
    const sub = this.subagents.find((entry) => entry.key === key);
    if (!sub) return;
    const sessionId = sub.sessionId ?? this.#context.sessionId;
    this.threads[key] = {
      updatedAt: this.threads[key]?.updatedAt ?? 0,
      messages: this.threads[key]?.messages ?? [],
      loading: true,
    };
    try {
      const value = await this.#context.invoke("thread", {
        ...(sessionId !== undefined ? { sessionId } : {}),
        id: sub.id,
      });
      const thread = parseThread(value);
      if (!thread) {
        this.threads[key] = {
          updatedAt: 0,
          messages: [],
          loading: false,
          error: "Subagents extension returned invalid thread data",
        };
        return;
      }
      this.threads[key] = { ...thread, loading: false };
    } catch (error) {
      this.threads[key] = {
        updatedAt: 0,
        messages: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  refresh(manual = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const sessionId = this.#context.sessionId;
    if (sessionId !== this.#sessionId) {
      // Another thread is open: its subagents are a different list.
      this.#sessionId = sessionId;
      this.subagents = [];
      this.selectedId = undefined;
      this.error = undefined;
      manual = true;
    }
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
      .invoke("snapshot", { sessionId })
      .then((value) => {
        if (this.#disposed || this.#context.sessionId !== sessionId) return;
        const snapshot = parseSnapshot(value);
        if (!snapshot) {
          this.error = "Subagents extension returned invalid data";
          return;
        }
        this.subagents = snapshot.subagents;
        this.updatedAt = snapshot.updatedAt;
        this.error = undefined;
        this.loading = false;
        // Open transcripts follow the live thread while it runs.
        for (const key of this.#openThreads) void this.loadThread(key);
      })
      .catch((error) => {
        if (this.#disposed || this.#context.sessionId !== sessionId) return;
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
    this.#openThreads.clear();
  }
}

function parseThread(value: unknown): Omit<ThreadView, "loading"> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as {
    updatedAt?: unknown;
    messages?: unknown;
  };
  if (typeof candidate.updatedAt !== "number") return undefined;
  if (!Array.isArray(candidate.messages)) return undefined;
  const messages: ThreadMessage[] = [];
  for (const entry of candidate.messages) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.role !== "string" || typeof raw.text !== "string") {
      return undefined;
    }
    messages.push({ role: raw.role, text: raw.text });
  }
  return { updatedAt: candidate.updatedAt, messages };
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
  const seen = new Set<string>();
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
    const sessionId =
      typeof raw.sessionId === "string" ? raw.sessionId : undefined;
    // Older servers send no key; derive one and never let two entries share
    // it, since the panel keys its list on it.
    let key =
      typeof raw.key === "string"
        ? raw.key
        : sessionId
          ? `${sessionId}:${raw.id}`
          : raw.id;
    while (seen.has(key)) key = `${key}#`;
    seen.add(key);
    subagents.push({
      key,
      sessionId,
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
