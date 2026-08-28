import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SVELTE_SYSTEM_PROMPT =
  "This workspace uses Svelte. Respect its existing Svelte version and conventions. Prefer the project's configured check, test, and build scripts for verification, and do not assume SvelteKit unless its packages or configuration are present.";

export default function svelte(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${SVELTE_SYSTEM_PROMPT}`,
  }));
}
