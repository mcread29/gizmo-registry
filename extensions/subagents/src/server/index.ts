/**
 * Gizmo integration for the subagents extension.
 *
 * Loaded in the agent-server process (not Pi's), so it cannot see the live
 * SubagentManager: the view reads the per-session state snapshots the Pi
 * extension writes (see ../state.ts). Read-only by design — steering and
 * cancellation belong to the process that owns the subagents.
 */

import { defineExtension, type SettingsField } from "@gizmo/extension-api";
import { TIER_SETTING_KEYS, TIERS, tierLabel } from "../tiers.ts";
import { openSubagentsView } from "./view.ts";

const TIER_HELP: Record<(typeof TIERS)[number], string> = {
  base: "Where every spawn starts: everyday breadth work.",
  mid: "Climbed to when the base rung fails.",
  strong: "The expensive rung, reached only when the others fail.",
};

/**
 * One model per rung of the ladder. The Pi side reads these straight from
 * Gizmo's settings file, ahead of anything `/subagents tiers` wrote.
 */
const settings: SettingsField[] = TIERS.map((tier) => ({
  kind: "model",
  key: TIER_SETTING_KEYS[tier],
  label: `${tierLabel(tier)} tier`,
  description: TIER_HELP[tier],
  thinking: true,
}));

export const gizmoExtension = defineExtension({
  id: "subagents",
  name: "Subagents",
  settings,
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
