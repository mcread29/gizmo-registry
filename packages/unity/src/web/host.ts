import type { Component } from "svelte";

export interface UnityHost {
  /** Per-extension open-in-progress flags; Unity reads `unity`. */
  projectOpening: Record<string, boolean>;
  /** Per-extension project-service errors; Unity reads `unity`. */
  projectServiceErrors: Record<string, string>;
  pendingConfirmations: PendingConfirmation[];
  resolveConfirmation(
    confirmation: PendingConfirmation,
    accepted: boolean,
  ): Promise<void>;
}

export interface PendingConfirmation {
  confirmationId: string;
}

export interface UnitySettings {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
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

export interface ExtensionContext {
  projectPath: string;
  invoke(operation: string, input?: unknown): Promise<unknown>;
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
