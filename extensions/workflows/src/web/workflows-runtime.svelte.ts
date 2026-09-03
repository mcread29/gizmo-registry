import type { Component } from "svelte";
import WorkflowsPanel from "./WorkflowsPanel.svelte";
import type {
  ExtensionContext,
  InspectorTabContribution,
  WebExtensionDefinition,
  WebExtensionRuntime,
} from "./types";
import type {
  AgentRecordView,
  RunSummary,
  TranscriptEntryView,
  WorkflowRunView,
} from "./types";

/**
 * Workflows' web runtime: polls the server-side runs operation and feeds the
 * inspector tab plus the drill-down run/agent views.
 */
export class WorkflowsRuntime implements WebExtensionRuntime {
  runs = $state<RunSummary[]>([]);
  loading = $state(true);
  error = $state<string>();

  selectedRunId = $state<string>();
  selectedAgentIndex = $state<number>();

  #run = $state<WorkflowRunView>();
  #runError = $state<string>();
  #transcript = $state<TranscriptEntryView[]>();
  #context: ExtensionContext | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #request?: Promise<void>;
  #disposed = false;
  /** Thread the current list belongs to; a switch refetches at once. */
  #sessionId: string | undefined;

  get inspectorTabs(): InspectorTabContribution[] {
    return [
      {
        id: "workflows.panel",
        label: "Workflows",
        badge: this.runningCount || undefined,
        badgeTone: "accent",
        component: WorkflowsPanel as Component<any>,
        props: { runtime: this },
      },
    ];
  }

  get runningCount(): number {
    return this.runs.filter((run) => run.status === "running").length;
  }

  get failedCount(): number {
    return this.runs.filter(
      (run) => run.status !== "running" && run.agentsFailed > 0,
    ).length;
  }

  get selectedRun(): WorkflowRunView | undefined {
    return this.#run;
  }

  get runError(): string | undefined {
    return this.#runError;
  }

  get transcript(): TranscriptEntryView[] {
    return this.#transcript ?? [];
  }

  attach(context: ExtensionContext): void {
    this.#context = context;
    void this.refresh();
    if (!this.#timer) {
      this.#timer = setInterval(() => void this.refresh(), 2_000);
    }
  }

  refresh(): Promise<void> {
    if (this.#disposed || !this.#context) return Promise.resolve();
    const sessionId = this.#context.sessionId;
    if (sessionId !== this.#sessionId) {
      // Another thread is open: its runs are a different list.
      this.#sessionId = sessionId;
      this.runs = [];
      this.selectedRunId = undefined;
      this.selectedAgentIndex = undefined;
      this.#run = undefined;
      this.#runError = undefined;
      this.#transcript = undefined;
      this.error = undefined;
      this.loading = true;
    } else if (this.#request) return this.#request;
    this.#request = this.#context
      .invoke("runs", { sessionId })
      .then((value) => {
        if (this.#disposed || this.#context?.sessionId !== sessionId) return;
        const runs = parseRuns(value);
        if (!runs) {
          this.error = "Workflows extension returned invalid data";
          return;
        }
        this.runs = runs;
        this.error = undefined;
        this.loading = false;
        // Keep the open run live while it executes.
        if (this.selectedRunId && this.#run?.status === "running") {
          void this.openRun(this.selectedRunId, { keepAgent: true });
        }
      })
      .catch((error) => {
        if (this.#disposed || this.#context?.sessionId !== sessionId) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.loading = false;
      })
      .finally(() => {
        this.#request = undefined;
      });
    return this.#request;
  }

  async openRun(
    runId: string,
    options: { keepAgent?: boolean } = {},
  ): Promise<void> {
    if (!this.#context) return;
    this.selectedRunId = runId;
    if (!options.keepAgent) {
      this.selectedAgentIndex = undefined;
      this.#transcript = undefined;
    }
    try {
      const value = await this.#context.invoke("run", { runId });
      const run = parseRun(value);
      if (!run) {
        this.#runError = "Workflow run returned invalid data";
        return;
      }
      this.#run = run;
      this.#runError = undefined;
    } catch (error) {
      this.#runError = error instanceof Error ? error.message : String(error);
    }
  }

  async openAgent(index: number): Promise<void> {
    this.selectedAgentIndex = index;
    this.#transcript = undefined;
    const runId = this.selectedRunId;
    if (!runId || !this.#context) return;
    try {
      const value = await this.#context.invoke("transcript", {
        runId,
        agent: index,
      });
      const entries = parseTranscript(value);
      this.#transcript = entries;
    } catch (error) {
      this.#runError = error instanceof Error ? error.message : String(error);
    }
  }

  closeRun(): void {
    this.selectedRunId = undefined;
    this.closeAgent();
    this.#run = undefined;
    this.#runError = undefined;
  }

  closeAgent(): void {
    this.selectedAgentIndex = undefined;
    this.#transcript = undefined;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

function parseRuns(value: unknown): RunSummary[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return undefined;
  const runs: RunSummary[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const record = entry as Record<string, unknown>;
    if (typeof record.runId !== "string") return undefined;
    runs.push({
      runId: record.runId,
      sessionId:
        typeof record.sessionId === "string" ? record.sessionId : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      status: typeof record.status === "string" ? record.status : undefined,
      background: record.background === true,
      startedAt:
        typeof record.startedAt === "number" ? record.startedAt : undefined,
      finishedAt:
        typeof record.finishedAt === "number" ? record.finishedAt : undefined,
      currentPhase:
        typeof record.currentPhase === "string"
          ? record.currentPhase
          : undefined,
      agentsTotal:
        typeof record.agentsTotal === "number" ? record.agentsTotal : 0,
      agentsSettled:
        typeof record.agentsSettled === "number" ? record.agentsSettled : 0,
      agentsFailed:
        typeof record.agentsFailed === "number" ? record.agentsFailed : 0,
      error: typeof record.error === "string" ? record.error : undefined,
    });
  }
  return runs;
}

function parseRun(value: unknown): WorkflowRunView | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.runId !== "string" || !Array.isArray(record.agents)) {
    return undefined;
  }
  const agents: AgentRecordView[] = [];
  for (const entry of record.agents) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const agent = entry as Record<string, unknown>;
    if (typeof agent.index !== "number") return undefined;
    agents.push({
      index: agent.index,
      label: typeof agent.label === "string" ? agent.label : undefined,
      phase: typeof agent.phase === "string" ? agent.phase : undefined,
      state: typeof agent.state === "string" ? agent.state : undefined,
      model: typeof agent.model === "string" ? agent.model : undefined,
      contextWindow:
        typeof agent.contextWindow === "number"
          ? agent.contextWindow
          : undefined,
      startedAt:
        typeof agent.startedAt === "number" ? agent.startedAt : undefined,
      finishedAt:
        typeof agent.finishedAt === "number" ? agent.finishedAt : undefined,
      error: typeof agent.error === "string" ? agent.error : undefined,
      preview: typeof agent.preview === "string" ? agent.preview : undefined,
      usage:
        typeof agent.usage === "object" && agent.usage !== null
          ? (agent.usage as AgentRecordView["usage"])
          : undefined,
    });
  }
  return {
    runId: record.runId,
    sessionId:
      typeof record.sessionId === "string" ? record.sessionId : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    description:
      typeof record.description === "string" ? record.description : undefined,
    background: record.background === true,
    status: typeof record.status === "string" ? record.status : undefined,
    startedAt:
      typeof record.startedAt === "number" ? record.startedAt : undefined,
    finishedAt:
      typeof record.finishedAt === "number" ? record.finishedAt : undefined,
    phases: Array.isArray(record.phases)
      ? (record.phases as WorkflowRunView["phases"])
      : [],
    currentPhase:
      typeof record.currentPhase === "string" ? record.currentPhase : undefined,
    agents,
    result: record.result,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

function parseTranscript(value: unknown): TranscriptEntryView[] {
  if (typeof value !== "object" || value === null) return [];
  const raw = (value as { entries?: unknown }).entries;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    return {
      role: typeof record.role === "string" ? record.role : "event",
      name: typeof record.name === "string" ? record.name : undefined,
      isError: record.isError === true,
      timestamp:
        typeof record.timestamp === "number" ? record.timestamp : undefined,
      text: typeof record.text === "string" ? record.text : "",
    };
  });
}

/** Lazy singleton so the definition object can be imported safely. */
let runtime: WorkflowsRuntime | undefined;

export const workflowsExtension: WebExtensionDefinition = {
  id: "workflows",
  apiVersion: 1,
  activate: (_descriptor, context: ExtensionContext) => {
    runtime?.dispose();
    runtime = new WorkflowsRuntime();
    runtime.attach(context);
    return runtime;
  },
};
