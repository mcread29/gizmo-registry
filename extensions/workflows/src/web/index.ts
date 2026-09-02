import WorkflowToolResult from "./WorkflowToolResult.svelte";
import { workflowsExtension } from "./workflows-runtime.svelte";
import type { RunSummary, WorkflowRunView } from "./types";

/**
 * Workflows' web presentation, paired with the Pi extension of the same id:
 * a native card for the workflow tool (phases, agents, live progress, result)
 * plus a live Workflows inspector tab backed by the run artifacts.
 */
export const gizmoWebExtension = {
  id: "workflows",
  apiVersion: workflowsExtension.apiVersion,
  activate: workflowsExtension.activate,
  labels: {
    workflow: "Workflow",
  },
  parametersFor: (name: string, parameters: [string, string][]) =>
    name === "workflow"
      ? parameters.filter(([param]) => param === "background")
      : parameters,
  resultFor: (name: string) =>
    name === "workflow" ? WorkflowToolResult : undefined,
};

export type { RunSummary, WorkflowRunView };
