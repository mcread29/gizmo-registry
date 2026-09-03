import type { Component } from "svelte";

/** Mirrors the app's `ExtensionContext`; kept local so the bundle never imports the app. */
export interface ExtensionContext {
  projectPath: string;
  invoke(operation: string, input?: unknown): Promise<unknown>;
}

/** Mirrors the app's `InspectorTabContribution`. */
export interface InspectorTabContribution {
  id: string;
  label: string;
  shortLabel?: string;
  badge?: number;
  badgeTone?: "accent" | "danger";
  component: Component<any>;
  props: Record<string, unknown>;
}

/** Mirrors the app's `WebExtensionRuntime`. */
export interface WebExtensionRuntime {
  readonly inspectorTabs: InspectorTabContribution[];
  dispose(): void;
}
