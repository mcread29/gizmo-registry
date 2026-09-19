import { createUnityTools } from "../../../../unity-tools/src/index";
import type { ExtensionContext } from "@gizmo/extension-api";
import { unitySystemPrompt } from "./unity-system-prompt";

/** The confirmation kind Unity asks the host for before it stops Play Mode. */
export const stopPlayModeConfirmation = "stop_play_mode_for_compile";

export const unityDomain = {
  id: "unity",
  name: "Unity",
  systemPrompt: unitySystemPrompt,
  createTools: ({ workspacePath, confirm }: ExtensionContext) =>
    createUnityTools({
      projectPath: workspacePath,
      confirmStopPlayMode: () =>
        confirm(stopPlayModeConfirmation, {
          title: "Stop Unity Play Mode?",
          message: "Unity must leave Play Mode before scripts can compile.",
        }),
    }),
};
