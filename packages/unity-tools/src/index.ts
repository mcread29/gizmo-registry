export { UnityRunner } from "./unity-runner";
export type {
  UnityCommandRunner,
  UnityRunnerOptions,
  UnityRunOptions,
  UnityRunResult,
} from "./unity-runner";
export { runUnityJson } from "./unity-json";
export type { UnityJsonDetails } from "./unity-json";
export { executeUnityCommand } from "./unity-command";
export type {
  ExecuteUnityCommandOptions,
  UnityCommandDetails,
} from "./unity-command";
export { createUnityCommandTool } from "./unity-command-tool";
export type { UnityCommandToolOptions } from "./unity-command-tool";
export { listUnityProjects, openUnityProject } from "./unity-projects";
export type {
  UnityOpenProjectDetails,
  UnityProject,
  UnityProjectsDetails,
} from "./unity-projects";
export { listUnityCommands } from "./unity-list-commands";
export type {
  UnityCommandParameter,
  UnityRegisteredCommand,
  UnityListCommandsDetails,
  UnityListCommandsOptions,
} from "./unity-list-commands";
export { createUnityListCommandsTool } from "./unity-list-commands-tool";
export type { UnityListCommandsToolOptions } from "./unity-list-commands-tool";
export { getUnityStatus, unityStatusArgs } from "./unity-status";
export type {
  UnityCliMessage,
  UnityEditorInstance,
  UnityStatusOptions,
  UnityStatusDetails,
} from "./unity-status";
export { createUnityStatusTool } from "./unity-status-tool";
export type { UnityToolOptions } from "./unity-status-tool";
export { waitForUnityCommand } from "./unity-wait-for-command";
export type {
  UnityCommandReloadDetails,
  WaitForUnityCommandOptions,
} from "./unity-wait-for-command";
export { createUnityWaitForCommandTool } from "./unity-wait-for-command-tool";
export type { UnityWaitForCommandToolOptions } from "./unity-wait-for-command-tool";
export { unityCommandTemplate } from "./unity-command-template";
export type {
  UnityCommandTemplate,
  UnityCommandTemplateOptions,
} from "./unity-command-template";
export { createUnityCommandTemplateTool } from "./unity-command-template-tool";
export { readUnityConsole } from "./unity-console";
export type {
  ReadUnityConsoleOptions,
  UnityConsoleDetails,
  UnityConsoleEntry,
  UnityConsoleLevel,
} from "./unity-console";
export {
  invokeUnityExtension,
  listUnityExtensions,
  unityExtensionCommands,
} from "./unity-extensions";
export type {
  UnityExtensionDescriptor,
  UnityExtensionOperation,
  UnityExtensionsDetails,
} from "./unity-extensions";
export { createUnityConsoleTool } from "./unity-console-tool";
export type { UnityConsoleToolOptions } from "./unity-console-tool";
export { UnityCompilationTracker } from "./unity-compilation-tracker";
export { waitForUnityCompile } from "./unity-wait-for-compile";
export type {
  UnityCompileDetails,
  WaitForUnityCompileOptions,
} from "./unity-wait-for-compile";
export { createUnityWaitForCompileTool } from "./unity-wait-for-compile-tool";
export type { UnityWaitForCompileToolOptions } from "./unity-wait-for-compile-tool";
export { runUnityTests } from "./unity-test";
export type {
  RunUnityTestsOptions,
  UnityTestDetails,
  UnityTestFilterType,
  UnityTestMode,
  UnityTestResult,
  UnityTestSummary,
} from "./unity-test";
export { createUnityTestTool } from "./unity-test-tool";
export type { UnityTestToolOptions } from "./unity-test-tool";
export { executeUnityScript, unityScriptDeclarations } from "./unity-script";
export type {
  UnityScriptDiagnostic,
  UnityScriptOptions,
  UnityScriptResult,
} from "./unity-script";
export { createUnityScriptTool } from "./unity-script-tool";
export type { UnityScriptToolOptions } from "./unity-script-tool";

import { createUnityListCommandsTool } from "./unity-list-commands-tool";
import { createUnityCommandTool } from "./unity-command-tool";
import { createUnityCommandTemplateTool } from "./unity-command-template-tool";
import { createUnityConsoleTool } from "./unity-console-tool";
import { UnityCompilationTracker } from "./unity-compilation-tracker";
import { createUnityTrackedFileTools } from "./unity-file-tools";
import { createUnityTestTool } from "./unity-test-tool";
import { createUnityScriptTool } from "./unity-script-tool";
import { createUnityWaitForCompileTool } from "./unity-wait-for-compile-tool";
import { createUnityWaitForCommandTool } from "./unity-wait-for-command-tool";
import {
  createUnityStatusTool,
  type UnityToolOptions,
} from "./unity-status-tool";

export interface CreateUnityToolsOptions extends UnityToolOptions {
  confirmStopPlayMode?: () => Promise<boolean>;
}

export function createUnityTools(options: CreateUnityToolsOptions = {}) {
  const projectPath = options.projectPath ?? process.cwd();
  const tracker = new UnityCompilationTracker();
  return [
    ...createUnityTrackedFileTools(projectPath, tracker),
    createUnityStatusTool(options),
    createUnityListCommandsTool(options),
    createUnityCommandTool({
      ...options,
      projectPath,
    }),
    createUnityConsoleTool({ ...options, projectPath }),
    createUnityWaitForCompileTool({ ...options, projectPath, tracker }),
    createUnityWaitForCommandTool({
      ...options,
      projectPath,
      tracker,
    }),
    createUnityTestTool({ ...options, projectPath }),
    createUnityScriptTool({ ...options, projectPath }),
    createUnityCommandTemplateTool(),
  ];
}

export const unityToolNames = [
  "unity_status",
  "unity_list_commands",
  "unity_command",
  "unity_console",
  "unity_wait_for_compile",
  "unity_wait_for_command",
  "unity_test",
  "unity_script",
  "unity_command_template",
] as const;
