import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerUnityDocs } from "../../packages/unity/src/server/docs/index.ts";
import { gizmoExtension } from "../../packages/unity/src/server/index.ts";
import { stopPlayModeConfirmation } from "../../packages/unity/src/server/domain/unity-domain.ts";

export { gizmoExtension };


export default function unity(pi: ExtensionAPI) {
  registerUnityDocs(pi);

  let currentContext: ExtensionContext | undefined;

  pi.on("tool_call", (_event, ctx) => {
    currentContext = ctx;
  });

  const tools =
    gizmoExtension.createTools?.({
      workspacePath: process.cwd(),
      // In a plain Pi session the confirmation goes through Pi's own UI;
      // under Gizmo the host supplies `confirm` and this is never used.
      async confirm(kind, options) {
        if (kind !== stopPlayModeConfirmation || !currentContext?.hasUI) {
          return false;
        }
        return currentContext.ui.confirm(
          options?.title ?? "Stop Unity Play Mode?",
          options?.message ??
            "Unity must leave Play Mode before scripts can compile.",
          { signal: currentContext.signal },
        );
      },
    }) ?? [];

  for (const tool of tools) pi.registerTool(tool);

  pi.on("before_agent_start", (event) => {
    const prompt = gizmoExtension.systemPrompt;
    if (!prompt || event.systemPrompt.includes(prompt)) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });
}
