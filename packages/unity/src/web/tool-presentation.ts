import CompilerDiagnosticList from "./unity/CompilerDiagnosticList.svelte";
import UnityToolResult from "./unity/UnityToolResult.svelte";

const resultToolNames = new Set([
  "unity_status",
  "unity_list_commands",
  "unity_console",
  "unity_wait_for_compile",
  "unity_wait_for_command",
  "unity_test",
  "unity_script",
]);

/** Adapts Unity's tools to the conversation view's generic tool-presentation contract. */
export const unityToolPresentation = {
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
  iconFor: (name: string) => (name.startsWith("unity_") ? "unity" : undefined),
  consoleEntriesKey: (name: string) =>
    name === "unity_console" ? "entries" : undefined,
  resultFor: (name: string) =>
    resultToolNames.has(name) ? UnityToolResult : undefined,
  parametersFor: (name: string, parameters: [string, string][]) =>
    name === "unity_script"
      ? parameters.filter(([param]) => param !== "code")
      : parameters,
  diagnosticsComponent: CompilerDiagnosticList,
};
