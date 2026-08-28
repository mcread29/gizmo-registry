import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Activity is provided by Gizmo's web UI; Pi only needs a valid extension
 * factory so the paired registry artifact can be activated.
 */
export default function activity(_pi: ExtensionAPI) {}
