import type { Component } from "svelte";

export interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  statusText: string;
  input?: unknown;
  result?: unknown;
}

export interface ExtensionContext {
  projectPath: string;
  /** Live thread id; changes when the user switches threads. */
  readonly sessionId?: string;
  invoke(operation: string, input?: unknown): Promise<unknown>;
}

export interface InspectorTabContribution {
  id: string;
  label: string;
  shortLabel?: string;
  badge?: number;
  badgeTone?: "accent" | "danger";
  component: Component<any>;
  props: Record<string, unknown>;
}

export interface WebExtensionRuntime {
  readonly inspectorTabs: InspectorTabContribution[];
  dispose(): void;
}

export interface WebExtensionDefinition {
  id: string;
  apiVersion: number;
  activate(descriptor: unknown, context: ExtensionContext): WebExtensionRuntime;
}

export interface RunSummary {
  runId: string;
  sessionId?: string;
  name?: string;
  status?: string;
  background?: boolean;
  startedAt?: number;
  finishedAt?: number;
  currentPhase?: string;
  agentsTotal: number;
  agentsSettled: number;
  agentsFailed: number;
  error?: string;
}

export interface AgentRecordView {
  index: number;
  label?: string;
  phase?: string;
  state?: string;
  model?: string;
  contextWindow?: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  preview?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: number;
    contextTokens?: number;
    turns?: number;
  };
}

export interface WorkflowRunView {
  runId: string;
  sessionId?: string;
  name?: string;
  description?: string;
  background?: boolean;
  status?: string;
  startedAt?: number;
  finishedAt?: number;
  phases?: { title?: string; detail?: string }[];
  currentPhase?: string;
  agents: AgentRecordView[];
  result?: unknown;
  error?: string;
}

export interface TranscriptEntryView {
  role: string;
  name?: string;
  isError: boolean;
  timestamp?: number;
  text: string;
}
