import type { Component } from "svelte";
import type { ToolCallView } from "@gizmo/protocol";
import ActivityPanel from "./ActivityPanel.svelte";

export interface ActivityInspectorTab {
  id: string;
  label: string;
  component: Component<any>;
  props: Record<string, unknown>;
}

/** Activity's single entry point into Gizmo's generic web extension contract. */
export const gizmoWebExtension = {
  id: "activity",
  name: "Activity",
  inspectorTabs(context: {
    toolActivity: ToolCallView[];
  }): ActivityInspectorTab[] {
    return [
      {
        id: "activity",
        label: "Activity",
        component: ActivityPanel as Component<any>,
        props: { view: { toolActivity: context.toolActivity } },
      },
    ];
  },
};
