import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerUnityDocs } from "../../packages/unity/src/server/docs/index.ts";
import { gizmoExtension } from "../../packages/unity/src/server/index.ts";

export { gizmoExtension };

const STOP_PLAY_MODE_CONFIRMATION = "stop_play_mode_for_compile";

export default function unity(pi: ExtensionAPI) {
  registerUnityDocs(pi);

  let currentContext: ExtensionContext | undefined;

  pi.on("tool_call", (_event, ctx) => {
    currentContext = ctx;
  });

  const tools =
    gizmoExtension.createTools?.({
      workspacePath: process.cwd(),
      async confirm(kind) {
        if (kind !== STOP_PLAY_MODE_CONFIRMATION || !currentContext?.hasUI) {
          return false;
        }
        return currentContext.ui.confirm(
          "Stop Unity Play Mode?",
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
