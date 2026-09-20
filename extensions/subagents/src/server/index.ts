/**
 * Gizmo integration for the subagents extension.
 *
 * Loaded in the agent-server process (not Pi's), so it cannot see the live
 * SubagentManager: the view reads the per-session state snapshots the Pi
 * extension writes (see ../state.ts). Read-only by design — steering and
 * cancellation belong to the process that owns the subagents.
 */

import { defineExtension } from "@gizmo/extension-api";
import { openSubagentsView } from "./view.ts";

export const gizmoExtension = defineExtension({
  id: "subagents",
  name: "Subagents",
  views: {
    panel: {
      label: "Subagents",
      scope: "thread",
      open: openSubagentsView,
    },
  },
  commands: () => [
    {
      id: "subagents.panel",
      label: "Subagents: Show panel",
      keywords: ["subagent", "background", "agents"],
      icon: "users",
      view: "panel",
    },
  ],
  toolPresentation: {
    labels: {
      subagent_spawn: "Spawn subagent",
      subagent_wait: "Wait for subagents",
      subagent_cancel: "Cancel subagents",
      subagent_check: "Check subagent",
      subagent_list: "List subagents",
    },
    icons: {
      subagent_spawn: "user-plus",
      subagent_wait: "hourglass",
      subagent_cancel: "circle-x",
      subagent_check: "search",
      subagent_list: "users",
    },
    parameters: {
      subagent_spawn: ["title", "working_dir", "tier", "reasoning_effort"],
      subagent_check: ["id"],
    },
  },
});

export { renderSubagentsView, openSubagentsView } from "./view.ts";
