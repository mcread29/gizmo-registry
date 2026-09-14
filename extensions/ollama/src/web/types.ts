import type { Component } from "svelte";
import type { HostStatus, JobSnapshot, ManagedModel } from "../shared/types.ts";

/** Mirrors the app's `AgentStore` surface this panel needs; kept local so the bundle never imports the app. */
export interface OllamaCommandStore {
  invokeProjectExtension(
    projectPath: string,
    extensionId: string,
    operation: string,
    input?: unknown,
  ): Promise<unknown>;
}

/** Mirrors the app's `InspectorTabContribution`. */
export interface OllamaInspectorTab {
  id: string;
  label: string;
  shortLabel?: string;
  badge?: number;
  badgeTone?: "accent" | "danger";
  component: Component<any>;
  props: Record<string, unknown>;
}

export type { HostStatus, JobSnapshot, ManagedModel };
