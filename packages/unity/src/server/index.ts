import { defineExtension, type SettingsField } from "@gizmo/extension-api";
import { openConsoleView } from "./console/console-view";
import { openEditorView } from "./editor-view";
import { UnityProjectService } from "./domain/unity-project-service";
import { unityDomain } from "./domain/unity-domain";
import { UnityExtensionProvider } from "./unity-extension-provider";

const extensionProvider = new UnityExtensionProvider();

const resultToolNames = [
  "unity_status",
  "unity_list_commands",
  "unity_console",
  "unity_wait_for_compile",
  "unity_wait_for_command",
  "unity_test",
  "unity_script",
];

const settings: SettingsField[] = [
  {
    kind: "select",
    key: "compilePlayModePolicy",
    label: "When Play Mode is active",
    description:
      "What happens when the agent needs to compile while the Unity Editor is in Play Mode.",
    options: [
      { value: "ask", label: "Ask" },
      { value: "stop", label: "Stop Play Mode" },
      { value: "keep_playing", label: "Keep playing" },
    ],
  },
];

/** Unity's single entry point into Gizmo's extension contract. */
export const gizmoExtension = defineExtension({
  id: unityDomain.id,
  name: unityDomain.name,
  systemPrompt: unityDomain.systemPrompt,
  createTools: unityDomain.createTools,
  list: (workspacePath, signal) =>
    extensionProvider.list(workspacePath, signal),
  invoke: (workspacePath, extensionId, operationId, input, signal) =>
    extensionProvider.invoke(
      workspacePath,
      extensionId,
      operationId,
      input,
      signal,
    ),
  createProjectService: () => new UnityProjectService(),

  settings,
  views: {
    editor: {
      label: "Unity",
      scope: "workspace",
      placement: "inspector",
      open: (context) => openEditorView(context),
    },
    console: {
      label: "Unity Console",
      shortLabel: "Logs",
      scope: "workspace",
      placement: "inspector",
      open: (context) => openConsoleView(extensionProvider, context),
    },
  },
  commands: () => [
    {
      id: "unity.editor",
      label: "Show Unity Editor status",
      keywords: ["unity", "editor", "status", "compile"],
      icon: "unity",
      view: "editor",
    },
    {
      id: "unity.console",
      label: "Show Unity Console",
      keywords: ["unity", "console", "logs", "errors"],
      icon: "unity",
      view: "console",
    },
  ],
  toolPresentation: {
    labels: {
      unity_status: "Unity Editor status",
      unity_list_commands: "Unity commands",
      unity_command: "Unity command",
      unity_console: "Unity console",
      unity_wait_for_compile: "Compile Unity project",
      unity_wait_for_command: "Reload Unity commands",
      unity_test: "Unity tests",
      unity_script: "Unity TypeScript",
      unity_command_template: "Unity command template",
    },
    icons: Object.fromEntries(
      [...resultToolNames, "unity_command", "unity_command_template"].map(
        (name) => [name, "unity"],
      ),
    ),
    // `code` is the whole script; the card shows what it was for instead.
    parameters: { unity_script: ["description", "timeoutMs"] },
  },
});

export { UnityProjectService } from "./domain/unity-project-service";
export { UnityExtensionProvider } from "./unity-extension-provider";
export { unitySystemPrompt } from "./domain/unity-system-prompt";
export { parseUnityStatus, parseUnityOpenProjectResult } from "./unity-wire";
export type { UnityStatus, UnityOpenProjectResult } from "./unity-wire";
