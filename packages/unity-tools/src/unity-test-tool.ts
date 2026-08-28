import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";
import { runUnityTests } from "./unity-test";

export interface UnityTestToolOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
}

export function createUnityTestTool(options: UnityTestToolOptions) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_test",
    label: "Run Unity tests",
    description:
      "Run synchronous EditMode or PlayMode tests in the connected Editor with focused name, assembly, or category filtering. Returns a normalized summary and linked failures.",
    promptSnippet:
      "Run focused Unity tests and return structured linked results",
    promptGuidelines: [
      "Prefer the narrowest relevant mode and filter after compiling project changes.",
      "Inspect each failed test and its linked source location; do not report success while relevant tests fail.",
    ],
    parameters: Type.Object(
      {
        mode: Type.Optional(
          Type.Union([
            Type.Literal("all"),
            Type.Literal("editor"),
            Type.Literal("playmode"),
          ]),
        ),
        filter: Type.Optional(Type.String({ maxLength: 500 })),
        filterType: Type.Optional(
          Type.Union([
            Type.Literal("testName"),
            Type.Literal("assembly"),
            Type.Literal("category"),
          ]),
        ),
        includeExplicit: Type.Optional(Type.Boolean()),
        timeoutSeconds: Type.Optional(
          Type.Integer({ minimum: 10, maximum: 900 }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal) {
      const details = await runUnityTests(runner, {
        projectPath: options.projectPath,
        ...params,
        signal,
      });
      return {
        content: [
          {
            type: "text",
            text: `${details.summary.passed}/${details.summary.total} Unity tests passed${details.summary.failed ? `; ${details.summary.failed} failed` : ""}.`,
          },
        ],
        details,
      };
    },
  });
}
