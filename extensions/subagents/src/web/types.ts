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
