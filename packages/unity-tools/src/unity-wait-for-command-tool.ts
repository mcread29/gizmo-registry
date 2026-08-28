import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { UnityCompilationTracker } from "./unity-compilation-tracker";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";
import { waitForUnityCommand } from "./unity-wait-for-command";

export interface UnityWaitForCommandToolOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
  tracker?: UnityCompilationTracker;
  confirmStopPlayMode?: () => Promise<boolean>;
}

export function createUnityWaitForCommandTool(
  options: UnityWaitForCommandToolOptions,
) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_wait_for_command",
    label: "Reload Unity commands",
    description:
      "Force the selected Unity Editor to recompile scripts, wait through its domain reload, and verify that an expected Pipeline command was registered. Use this after writing or editing an Editor-side command.",
    promptSnippet: "Reload scripts and wait for a Unity command to register",
    promptGuidelines: [
      "After authoring or changing an Editor-side Pipeline command, call unity_wait_for_command before invoking it.",
      "This tool waits for Play Mode decisions, compilation, and domain reload internally. Do not poll unity_status while it runs or after it returns a final result.",
      "If compilation fails, inspect the returned compiler errors and fix the source before retrying.",
    ],
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          maxLength: 256,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$",
        }),
        timeoutSeconds: Type.Optional(
          Type.Integer({ minimum: 10, maximum: 300 }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, onUpdate) {
      const details = await waitForUnityCommand(runner, {
        projectPath: options.projectPath,
        command: params.command,
        timeoutMs: (params.timeoutSeconds ?? 120) * 1_000,
        signal,
        confirmStopPlayMode: options.confirmStopPlayMode,
        onProgress: (message) =>
          onUpdate?.({
            content: [{ type: "text", text: message }],
            details: undefined,
          }),
      });
      if (
        details.compileStatus === "completed" ||
        details.compileStatus === "up_to_date"
      ) {
        options.tracker?.clear();
      }
      return {
        content: [{ type: "text", text: summarize(details) }],
        details,
      };
    },
  });
}

function summarize(details: Awaited<ReturnType<typeof waitForUnityCommand>>) {
  if (details.ok) {
    return `${details.expectedCommand} registered after Unity script reload.`;
  }
  return details.errors
    .map((error) => `${error.code}: ${error.message}`)
    .join("\n");
}
