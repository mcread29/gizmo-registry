import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readUnityConsole } from "./unity-console";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";

export interface UnityConsoleToolOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
}

export function createUnityConsoleTool(options: UnityConsoleToolOptions) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_console",
    label: "Unity console",
    description:
      "Read structured Unity Editor console entries with severity filters, cursors, stack traces, and source locations.",
    promptSnippet: "Read structured Unity Editor console diagnostics",
    promptGuidelines: [
      "Use unity_console after runtime or Editor operations when their behavior needs diagnostic context.",
      "Prefer level warn or error and a bounded tail instead of returning the entire console history.",
    ],
    parameters: Type.Object(
      {
        tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        level: Type.Optional(
          Type.Union([
            Type.Literal("log"),
            Type.Literal("warn"),
            Type.Literal("error"),
          ]),
        ),
        since: Type.Optional(Type.Integer({ minimum: -1 })),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const details = await readUnityConsole(runner, {
        projectPath: options.projectPath,
        ...params,
        signal,
      });
      return {
        content: [
          {
            type: "text",
            text: details.ok
              ? `${details.entries.length} Unity console entries.`
              : details.errors
                  .map((error) => `${error.code}: ${error.message}`)
                  .join("\n"),
          },
        ],
        details,
      };
    },
  });
}
