import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { listUnityCommands } from "./unity-list-commands";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";

export interface UnityListCommandsToolOptions {
  runner?: UnityCommandRunner;
  projectPath?: string;
}

export function createUnityListCommandsTool(
  options: UnityListCommandsToolOptions = {},
) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_list_commands",
    label: "List Unity commands",
    description:
      "List commands currently registered by the Pipeline package in a connected Unity Editor. Use this to discover custom commands instead of assuming names or schemas.",
    promptSnippet: "Discover registered Unity Pipeline commands",
    promptGuidelines: [
      "Use unity_list_commands to discover custom Editor commands; do not invent command names.",
    ],
    parameters: Type.Object(
      {
        query: Type.Optional(Type.String({ maxLength: 200 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const details = await listUnityCommands(runner, {
        ...(options.projectPath ? { projectPath: options.projectPath } : {}),
        ...(params.query ? { query: params.query } : {}),
        limit: params.limit ?? 20,
        signal,
      });
      return {
        content: [{ type: "text", text: summarize(details) }],
        details,
      };
    },
  });
}

function summarize(
  details: Awaited<ReturnType<typeof listUnityCommands>>,
): string {
  if (details.ok)
    return JSON.stringify({
      commands: details.commands,
      matchedCommands: details.matchedCommands,
      totalCommands: details.totalCommands,
    });
  return details.errors
    .map((error) => `${error.code}: ${error.message}`)
    .join("\n");
}
