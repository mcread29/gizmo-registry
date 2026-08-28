import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeUnityCommand } from "./unity-command";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";

export interface UnityCommandToolOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
}

export function createUnityCommandTool(options: UnityCommandToolOptions) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_command",
    label: "Run Unity command",
    description:
      "Execute a command registered by the Pipeline package in the selected Unity Editor. Discover command names and argument schemas with unity_list_commands first. This harness grants full command access without an approval prompt.",
    promptSnippet: "Execute registered commands in the selected Unity Editor",
    promptGuidelines: [
      "Use unity_list_commands before unity_command so command names and arguments match the connected Editor schema.",
      "Prefer the parameters object so names are validated against the live Editor schema. Use raw args only for an Editor command whose schema cannot represent its syntax.",
    ],
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          maxLength: 256,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$",
        }),
        args: Type.Optional(
          Type.Array(Type.String({ maxLength: 8_192 }), {
            maxItems: 100,
          }),
        ),
        parameters: Type.Optional(
          Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
        ),
        timeoutSeconds: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 300 }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const details = await executeUnityCommand(runner, {
        projectPath: options.projectPath,
        command: params.command,
        ...(params.args ? { args: params.args } : {}),
        ...(params.parameters ? { parameters: params.parameters } : {}),
        ...(params.timeoutSeconds
          ? { timeoutSeconds: params.timeoutSeconds }
          : {}),
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
  details: Awaited<ReturnType<typeof executeUnityCommand>>,
): string {
  if (details.ok) return JSON.stringify(details.data);
  return details.errors
    .map((error) => `${error.code}: ${error.message}`)
    .join("\n");
}
