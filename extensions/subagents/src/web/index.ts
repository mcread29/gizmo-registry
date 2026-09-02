import SubagentToolResult from "./SubagentToolResult.svelte";
import {
  subagentsExtension,
  type SubagentEntry,
} from "./subagents-runtime.svelte";

/**
 * Subagents' web presentation, paired with the Pi extension of the same id:
 * native cards for the five subagent tools plus a live Subagents inspector
 * tab fed by the agent-server snapshot operation.
 */
export const gizmoWebExtension = {
  id: "subagents",
  apiVersion: subagentsExtension.apiVersion,
  activate: subagentsExtension.activate,
  labels: {
    subagent_spawn: "Spawn subagent",
    subagent_wait: "Wait for subagents",
    subagent_cancel: "Cancel subagents",
    subagent_check: "Check subagent",
    subagent_list: "List subagents",
  },
  parametersFor: (name: string, parameters: [string, string][]) => {
    if (name === "subagent_spawn") {
      return parameters.filter(([param]) =>
        [
          "title",
          "working_dir",
          "model",
          "provider",
          "reasoning_effort",
        ].includes(param),
      );
    }
    if (name === "subagent_check") {
      return parameters.filter(([param]) => param === "id");
    }
    return parameters;
  },
  resultFor: (name: string) =>
    name.startsWith("subagent_") ? SubagentToolResult : undefined,
};

export type { SubagentEntry };
