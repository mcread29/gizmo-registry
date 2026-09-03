/**
 * Codex - show OpenAI Codex usage and rate limits in Gizmo.
 *
 * Pi only needs a valid extension factory here; the integration lives in
 * `gizmoExtension` (src/server), which answers the web UI's `usage` operation
 * from ChatGPT's Codex backend using the local `~/.codex` sign-in. The paired
 * browser bundle renders it as a status bar indicator and a usage panel.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { gizmoExtension } from "./src/server/index.ts";

export { gizmoExtension };

export default function codex(_pi: ExtensionAPI) {}
