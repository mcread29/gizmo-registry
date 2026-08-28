import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getUnityStatus } from "./unity-status";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";

export interface UnityToolOptions {
  runner?: UnityCommandRunner;
  projectPath?: string;
}

export function createUnityStatusTool(options: UnityToolOptions = {}) {
  const runner = options.runner ?? new UnityRunner();
  return defineTool({
    name: "unity_status",
    label: "Unity status",
    description:
      "Inspect connected Unity Editor instances, including their project, version, process, port, and connection state. Use this before attempting Editor commands.",
    promptSnippet: "Inspect connected Unity Editor instances",
    promptGuidelines: [
      "Call unity_status before assuming that a Unity Editor or Pipeline connection is available.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, signal) {
      const details = await getUnityStatus(runner, {
        ...(options.projectPath ? { projectPath: options.projectPath } : {}),
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
  details: Awaited<ReturnType<typeof getUnityStatus>>,
): string {
  if (details.state === "connected") {
    return JSON.stringify({
      connectedEditors: details.instances.length,
      instances: details.instances,
    });
  }
  return details.errors
    .map((error) => `${error.code}: ${error.message}`)
    .join("\n");
}
