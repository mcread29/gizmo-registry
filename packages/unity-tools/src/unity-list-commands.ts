import {
  runUnityJson,
  unityJsonArgs,
  type UnityJsonDetails,
} from "./unity-json";
import type { UnityCommandRunner } from "./unity-runner";

export interface UnityListCommandsOptions {
  projectPath?: string;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface UnityCommandParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  default?: unknown;
}

export interface UnityRegisteredCommand {
  name: string;
  description?: string;
  group?: string;
  parameters: UnityCommandParameter[];
}

export interface UnityListCommandsDetails extends UnityJsonDetails {
  state: "available" | "disconnected" | "unavailable" | "error";
  commands: UnityRegisteredCommand[];
  totalCommands: number;
  matchedCommands: number;
}

export async function listUnityCommands(
  runner: UnityCommandRunner,
  options: UnityListCommandsOptions = {},
): Promise<UnityListCommandsDetails> {
  const args = [
    ...unityJsonArgs,
    "list",
    ...(options.projectPath ? ["--project-path", options.projectPath] : []),
  ];
  const result = await runUnityJson(runner, args, { signal: options.signal });
  const catalog = extractCommands(result.data);
  const matches = filterCommands(catalog, options.query);
  const commands = options.limit ? matches.slice(0, options.limit) : matches;
  return {
    ...result,
    state: result.ok
      ? "available"
      : result.errors.some((error) =>
            error.message.includes("No Unity Editor instances"),
          )
        ? "disconnected"
        : result.errors.some((error) => error.code === "UNITY_CLI_UNAVAILABLE")
          ? "unavailable"
          : "error",
    commands,
    totalCommands: catalog.length,
    matchedCommands: matches.length,
  };
}

function extractCommands(data: unknown): UnityRegisteredCommand[] {
  let commands: unknown[] = [];
  if (Array.isArray(data)) commands = data;
  else if (data && typeof data === "object") {
    if ("commands" in data && Array.isArray(data.commands)) {
      commands = data.commands;
    } else if ("tools" in data && Array.isArray(data.tools)) {
      commands = data.tools;
    }
  }
  return commands
    .map(normalizeCommand)
    .filter((command) => command !== undefined);
}

function normalizeCommand(
  command: unknown,
): UnityRegisteredCommand | undefined {
  if (typeof command === "string") return { name: command, parameters: [] };
  if (!command || typeof command !== "object") return;
  if (!("name" in command) || typeof command.name !== "string") return;
  return {
    name: command.name,
    ...("description" in command && typeof command.description === "string"
      ? { description: command.description }
      : {}),
    ...("group" in command && typeof command.group === "string"
      ? { group: command.group }
      : {}),
    parameters:
      "parameters" in command && Array.isArray(command.parameters)
        ? command.parameters
            .map(normalizeParameter)
            .filter((parameter) => parameter !== undefined)
        : [],
  };
}

function normalizeParameter(
  parameter: unknown,
): UnityCommandParameter | undefined {
  if (!parameter || typeof parameter !== "object") return;
  if (!("name" in parameter) || typeof parameter.name !== "string") return;
  return {
    name: parameter.name,
    type:
      "type" in parameter && typeof parameter.type === "string"
        ? parameter.type
        : "unknown",
    ...("description" in parameter && typeof parameter.description === "string"
      ? { description: parameter.description }
      : {}),
    required:
      "required" in parameter && typeof parameter.required === "boolean"
        ? parameter.required
        : false,
    ...("default" in parameter ? { default: parameter.default } : {}),
  };
}

function filterCommands(
  commands: UnityRegisteredCommand[],
  query?: string,
): UnityRegisteredCommand[] {
  const terms = query?.toLowerCase().trim().split(/\s+/).filter(Boolean) ?? [];
  if (!terms.length) return commands;
  return commands.filter((command) => {
    const searchable = [
      command.name,
      command.description,
      command.group,
      ...command.parameters.flatMap((parameter) => [
        parameter.name,
        parameter.type,
        parameter.description,
      ]),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
