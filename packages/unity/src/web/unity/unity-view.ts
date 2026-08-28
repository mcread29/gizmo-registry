import type {
  ConversationMessage,
  ToolCallView,
  StoredProject,
  UnityStatus,
} from "../types";
import {
  compilerDiagnostics,
  type CompilerDiagnostic,
} from "./compiler-diagnostics";

export type UnityLifecycleState =
  | "ready"
  | "pending"
  | "compiling"
  | "reloading"
  | "verifying"
  | "failed"
  | "disconnected"
  | "unknown";

export interface UnityLifecycle {
  state: UnityLifecycleState;
  label: string;
  errors: CompilerDiagnostic[];
  pendingPaths: string[];
}

export interface UnityView {
  selectedProject?: StoredProject;
  status?: UnityStatus;
  editor?: Record<string, unknown>;
  projectPath?: string;
  projectName: string;
  version?: string;
  state: string;
  lifecycle: UnityLifecycle;
  consoleDiagnostics: CompilerDiagnostic[];
  testResult?: unknown;
  toolActivity: ToolCallView[];
}

interface UnityViewInput {
  messages: ConversationMessage[];
  projects: StoredProject[];
  selectedProjectPath?: string;
  projectStatus?: UnityStatus;
  projectsLoading: boolean;
}

export function createUnityView(input: UnityViewInput): UnityView {
  const toolActivity = input.messages.flatMap((message) => message.tools);
  const selectedProject = input.projects.find(
    (project) => project.path === input.selectedProjectPath,
  );
  const status = input.projectStatus ?? findUnityStatus(toolActivity);
  const editor = status?.instances[0];
  const projectPath =
    readEditorValue(editor, ["projectPath", "project"]) ??
    selectedProject?.path;
  const projectNameValue =
    selectedProject?.title ??
    readEditorValue(editor, ["projectName", "name"]) ??
    projectName(projectPath) ??
    (input.projectsLoading ? "Loading projects" : "Select a project");
  const version =
    readEditorValue(editor, ["version", "unityVersion"]) ?? undefined;
  const state =
    readEditorValue(editor, ["state", "connectionState"]) ??
    statusLabel(status?.state);
  const lifecycle = lifecycleFrom(toolActivity, status);
  const consoleDiagnostics = latestConsoleDiagnostics(toolActivity);
  const testResult = latestToolResult(toolActivity, "unity_test");

  return {
    ...(selectedProject ? { selectedProject } : {}),
    ...(status ? { status } : {}),
    ...(editor ? { editor } : {}),
    ...(projectPath ? { projectPath } : {}),
    projectName: projectNameValue,
    ...(version ? { version } : {}),
    state,
    lifecycle,
    consoleDiagnostics,
    ...(testResult === undefined ? {} : { testResult }),
    toolActivity,
  };
}

function lifecycleFrom(
  tools: ToolCallView[],
  status: UnityStatus | undefined,
): UnityLifecycle {
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index];
    if (
      tool.name === "unity_wait_for_compile" ||
      tool.name === "unity_wait_for_command"
    ) {
      if (tool.status === "running") {
        const text = tool.statusText.toLowerCase();
        if (text.includes("verif"))
          return lifecycle("verifying", "Verifying command");
        if (text.includes("compil"))
          return lifecycle("compiling", "Compiling scripts");
        return lifecycle("reloading", "Reloading scripts");
      }
      const result = record(tool.result);
      const resultState = typeof result?.state === "string" ? result.state : "";
      if (tool.status === "complete" && resultState === "ready") {
        return lifecycle("ready", "Ready");
      }
      if (
        tool.status === "error" ||
        ["compile_failed", "command_missing", "timeout", "error"].includes(
          resultState,
        )
      ) {
        return lifecycle(
          "failed",
          "Compilation failed",
          compilerDiagnostics(result?.errors),
        );
      }
      continue;
    }
    if (tool.name !== "edit" && tool.name !== "write") continue;
    const result = record(tool.result);
    if (result?.compilationPending === true) {
      return lifecycle(
        "pending",
        "Compile pending",
        [],
        stringArray(result.compilationPaths),
      );
    }
  }

  if (status?.state === "connected") return lifecycle("ready", "Ready");
  if (status?.state === "disconnected")
    return lifecycle("disconnected", "Disconnected");
  return lifecycle("unknown", statusLabel(status?.state));
}

function lifecycle(
  state: UnityLifecycleState,
  label: string,
  errors: CompilerDiagnostic[] = [],
  pendingPaths: string[] = [],
): UnityLifecycle {
  return { state, label, errors, pendingPaths };
}

function latestConsoleDiagnostics(tools: ToolCallView[]): CompilerDiagnostic[] {
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index];
    const result = record(tool.result);
    if (
      (tool.name === "unity_wait_for_compile" ||
        tool.name === "unity_wait_for_command") &&
      Array.isArray(result?.consoleEntries)
    ) {
      return compilerDiagnostics(result.consoleEntries);
    }
    if (tool.name === "unity_console" && Array.isArray(result?.entries)) {
      return compilerDiagnostics(result.entries);
    }
  }
  return [];
}

function latestToolResult(
  tools: ToolCallView[],
  name: string,
): unknown | undefined {
  for (let index = tools.length - 1; index >= 0; index--) {
    if (tools[index]?.name === name && tools[index]?.result !== undefined) {
      return tools[index]!.result;
    }
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readEditorValue(
  instance: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!instance) return;
  for (const key of keys) {
    const value = instance[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
}

export function statusLabel(state: UnityStatus["state"] | undefined): string {
  switch (state) {
    case "connected":
      return "Ready";
    case "disconnected":
      return "Disconnected";
    case "unavailable":
      return "CLI unavailable";
    case "error":
      return "Check failed";
    default:
      return "Not checked";
  }
}

function findUnityStatus(tools: ToolCallView[]): UnityStatus | undefined {
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index];
    if (tool.name !== "unity_status" || !isUnityStatus(tool.result)) continue;
    return tool.result;
  }
}

function isUnityStatus(value: unknown): value is UnityStatus {
  if (!value || typeof value !== "object") return false;
  const state = "state" in value ? value.state : undefined;
  return (
    (state === "connected" ||
      state === "disconnected" ||
      state === "unavailable" ||
      state === "error") &&
    "instances" in value &&
    Array.isArray(value.instances) &&
    "errors" in value &&
    Array.isArray(value.errors)
  );
}

export function commandName(command: unknown): string | undefined {
  if (typeof command === "string") return command;
  if (!command || typeof command !== "object") return;
  const record = command as Record<string, unknown>;
  for (const key of ["name", "command", "id"]) {
    if (typeof record[key] === "string") return record[key];
  }
}

function projectName(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1);
}
