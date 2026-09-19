import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineExtension } from "@gizmo/extension-api";

/**
 * Activity is rendered by Gizmo itself from the tool calls it already
 * tracks, so this extension contributes no view: nothing in the view
 * protocol lets an extension read the host's tool activity, and the data
 * never leaves the client. Pi only needs a valid extension factory here.
 */
export const gizmoExtension = defineExtension({
  id: "activity",
  name: "Activity",
});

export default function activity(_pi: ExtensionAPI) {}
