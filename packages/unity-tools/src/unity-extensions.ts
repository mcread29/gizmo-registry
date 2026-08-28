import {
  parseCommandResult,
  runUnityJson,
  unityJsonArgs,
  type UnityJsonDetails,
} from "./unity-json";
import type { UnityCommandRunner } from "./unity-runner";

export interface UnityExtensionOperation {
  id: string;
  mutates: boolean;
  requiresConfirmation: boolean;
}

export interface UnityExtensionDescriptor {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
  operations: UnityExtensionOperation[];
}

export interface UnityExtensionsDetails extends UnityJsonDetails {
  extensions: UnityExtensionDescriptor[];
}

const discoveryCommand = "gizmo_extensions";
const invokeCommand = "gizmo_extension_invoke";

export async function listUnityExtensions(
  runner: UnityCommandRunner,
  projectPath: string,
  signal?: AbortSignal,
): Promise<UnityExtensionsDetails> {
  const details = await runExtensionCommand(
    runner,
    projectPath,
    discoveryCommand,
    [],
    signal,
  );
  const result = record(parseCommandResult(details.data));
  return {
    ...details,
    extensions: Array.isArray(result?.extensions)
      ? result.extensions
          .map(extensionDescriptor)
          .filter(
            (extension): extension is UnityExtensionDescriptor =>
              extension !== undefined,
          )
      : [],
  };
}

export async function invokeUnityExtension(
  runner: UnityCommandRunner,
  projectPath: string,
  extensionId: string,
  operation: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const details = await runExtensionCommand(
    runner,
    projectPath,
    invokeCommand,
    [
      "--extension",
      extensionId,
      "--operation",
      operation,
      "--input",
      JSON.stringify(input ?? null),
    ],
    signal,
  );
  if (!details.ok) {
    throw new Error(
      details.errors[0]?.message ?? `Extension operation failed: ${operation}`,
    );
  }
  return parseCommandResult(details.data);
}

export const unityExtensionCommands = { discoveryCommand, invokeCommand };

async function runExtensionCommand(
  runner: UnityCommandRunner,
  projectPath: string,
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
) {
  return runUnityJson(
    runner,
    [
      ...unityJsonArgs,
      "command",
      "--project-path",
      projectPath,
      command,
      ...(args.length ? ["--", ...args] : []),
    ],
    { signal },
  );
}

function extensionDescriptor(
  value: unknown,
): UnityExtensionDescriptor | undefined {
  const extension = record(value);
  const id = string(extension?.id);
  const name = string(extension?.name);
  const version = string(extension?.version);
  const apiVersion = integer(extension?.apiVersion);
  if (!id || !name || !version || apiVersion === undefined) return;
  return {
    id,
    name,
    version,
    apiVersion,
    capabilities: strings(extension?.capabilities),
    operations: Array.isArray(extension?.operations)
      ? extension.operations
          .map(extensionOperation)
          .filter(
            (operation): operation is UnityExtensionOperation =>
              operation !== undefined,
          )
      : [],
  };
}

function extensionOperation(
  value: unknown,
): UnityExtensionOperation | undefined {
  const operation = record(value);
  const id = string(operation?.id);
  if (!id) return;
  return {
    id,
    mutates: operation?.mutates === true,
    requiresConfirmation: operation?.requiresConfirmation === true,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1
    ? (value as number)
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}
