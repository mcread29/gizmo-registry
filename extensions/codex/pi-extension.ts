/**
 * Codex - show OpenAI Codex usage and rate limits in Gizmo.
 *
 * Pi only needs a valid extension factory here; the integration lives in
 * `gizmoExtension` (src/server), which reads usage and rate limits from
 * ChatGPT's Codex backend using the local `~/.codex` sign-in and contributes
 * a titlebar status item plus a usage view.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { gizmoExtension } from "./src/server/index.ts";

export { gizmoExtension };

export default function codex(_pi: ExtensionAPI) {}
