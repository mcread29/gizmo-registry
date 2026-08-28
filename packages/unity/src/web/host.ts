import type { Component } from "svelte";

export interface UnityHost {
  projectOpening: boolean;
  projectError?: string;
  pendingConfirmations: PendingConfirmation[];
  resolveConfirmation(
    confirmation: PendingConfirmation,
    accepted: boolean,
  ): Promise<void>;
}

export interface PendingConfirmation {
  confirmationId: string;
}

export interface UnityLayout {
  compilePlayModePolicy: "ask" | "stop" | "keep_playing";
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
