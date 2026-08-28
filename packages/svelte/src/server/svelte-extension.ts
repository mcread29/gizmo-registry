import type { GizmoServerExtension } from "@gizmo/extensions";

export const svelteExtension: GizmoServerExtension = {
  id: "svelte",
  name: "Svelte",
  systemPrompt: `This workspace uses Svelte. Respect its existing Svelte version and conventions. Prefer the project's configured check, test, and build scripts for verification, and do not assume SvelteKit unless its packages or configuration are present.`,
  createTools: () => [],
};
