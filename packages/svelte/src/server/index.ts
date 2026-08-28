import type { GizmoServerExtension } from "@gizmo/extensions";
import { svelteExtension } from "./svelte-extension";

/** Svelte's single entry point into Gizmo's generic extension contract. */
export const gizmoExtension: GizmoServerExtension = svelteExtension;

export { svelteExtension };
