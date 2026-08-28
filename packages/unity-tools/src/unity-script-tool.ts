import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeUnityScript } from "./unity-script";
import type { UnityCommandRunner } from "./unity-runner";

export interface UnityScriptToolOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
}

export function createUnityScriptTool(options: UnityScriptToolOptions) {
  return defineTool({
    name: "unity_script",
    label: "Run Unity TypeScript",
    description:
      "Compose several approved Unity CLI and connected-Editor operations in one type-checked TypeScript script. The runtime generates command types from the live Editor entirely in memory. Node, filesystem, shell, and package imports are unavailable.",
    promptSnippet:
      "Run type-checked TypeScript workflows against the Unity CLI and connected Editor",
    promptGuidelines: [
      'Use unity.commands["command.name"]({ ... }) for commands registered by the connected Editor.',
      'Use unity.json<T>(["status"]) for structured CLI data or unity.exec([...]) when the full result envelope is needed.',
      "Return the final useful value from the script and use console.log only for concise progress.",
    ],
    parameters: Type.Object(
      {
        code: Type.String({ minLength: 1, maxLength: 30_000 }),
        timeoutSeconds: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 300 }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, onUpdate) {
      const details = await executeUnityScript(params.code, {
        projectPath: options.projectPath,
        ...(options.runner ? { runner: options.runner } : {}),
        ...(params.timeoutSeconds
          ? { timeoutSeconds: params.timeoutSeconds }
          : {}),
        signal,
        onLog: (message) =>
          onUpdate?.({
            content: [{ type: "text", text: message }],
            details: undefined,
          }),
      });
      return {
        content: [{ type: "text", text: summarize(details) }],
        details,
      };
    },
  });
}

function summarize(
  details: Awaited<ReturnType<typeof executeUnityScript>>,
): string {
  if (details.ok) return JSON.stringify(details.value ?? null);
  if (details.diagnostics.length) {
    return details.diagnostics
      .map(
        (item) =>
          `${item.line ?? 1}:${item.column ?? 1} TS${item.code}: ${item.message}`,
      )
      .join("\n");
  }
  return details.error ?? "Unity script failed";
}
