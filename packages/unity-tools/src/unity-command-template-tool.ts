import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { unityCommandTemplate } from "./unity-command-template";

export function createUnityCommandTemplateTool() {
  return defineTool({
    name: "unity_command_template",
    label: "Unity command template",
    description:
      "Generate a current Unity Pipeline command starter in C#. Use it as a baseline before writing a project-specific Editor command.",
    promptSnippet: "Generate a Unity Pipeline command starter",
    promptGuidelines: [
      "Inspect the project for existing command conventions before using the generated source.",
      "Adapt the template to the project, write it under an Editor assembly, then call unity_wait_for_command.",
    ],
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          maxLength: 256,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$",
        }),
        description: Type.String({ minLength: 1, maxLength: 500 }),
        namespace: Type.Optional(
          Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_.]*$" }),
        ),
        className: Type.Optional(
          Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params) {
      const details = unityCommandTemplate(params);
      return {
        content: [{ type: "text" as const, text: details.source }],
        details,
      };
    },
  });
}
