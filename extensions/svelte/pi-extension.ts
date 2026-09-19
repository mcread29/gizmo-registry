import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineExtension } from "@gizmo/extension-api";

const SVELTE_SYSTEM_PROMPT =
  "This workspace uses Svelte. Respect its existing Svelte version and conventions. Prefer the project's configured check, test, and build scripts for verification, and do not assume SvelteKit unless its packages or configuration are present.";

/** Svelte contributes guidance only: no tools, no views, nothing to render. */
export const gizmoExtension = defineExtension({
  id: "svelte",
  name: "Svelte",
  systemPrompt: SVELTE_SYSTEM_PROMPT,
});

export default function svelte(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    if (event.systemPrompt.includes(SVELTE_SYSTEM_PROMPT)) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${SVELTE_SYSTEM_PROMPT}` };
  });
}
