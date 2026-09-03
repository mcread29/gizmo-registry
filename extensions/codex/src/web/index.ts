import { usageTone } from "../usage.ts";
import { activeCodexRuntime, CodexRuntime } from "./codex-runtime.svelte.ts";
import type { ExtensionContext, WebExtensionRuntime } from "./types.ts";

/**
 * Codex's web presentation, paired with the Pi extension of the same id:
 * a titlebar usage indicator plus a live Codex usage inspector tab fed by
 * the agent-server `usage` operation.
 */
export const gizmoWebExtension = {
  id: "codex",
  apiVersion: 1,
  activate(
    _descriptor: unknown,
    context: ExtensionContext,
  ): WebExtensionRuntime {
    return new CodexRuntime(context);
  },
  statusBar(_context: { store: unknown; projectPath?: string }) {
    const runtime = activeCodexRuntime();
    const worst = runtime?.worstUsedPercent;
    if (worst === undefined) return [];
    return [
      {
        id: "codex.usage",
        label: `Codex ${Math.round(worst)}%`,
        tone: usageTone(worst),
      },
    ];
  },
};
