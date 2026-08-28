import {
  runUnityJson,
  unityJsonArgs,
  type UnityJsonDetails,
} from "./unity-json";
import {
  listUnityCommands,
  type UnityRegisteredCommand,
  type UnityListCommandsDetails,
} from "./unity-list-commands";
import type { UnityCommandRunner } from "./unity-runner";

export interface ExecuteUnityCommandOptions {
  projectPath: string;
  command: string;
  args?: readonly string[];
  parameters?: Readonly<Record<string, unknown>>;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface UnityCommandDetails extends UnityJsonDetails {
  state:
    "completed" | "disconnected" | "unavailable" | "unregistered" | "error";
  editorCommand: string;
  args: readonly string[];
}

export async function executeUnityCommand(
  runner: UnityCommandRunner,
  options: ExecuteUnityCommandOptions,
): Promise<UnityCommandDetails> {
  const listed = await listUnityCommands(runner, {
    projectPath: options.projectPath,
    signal: options.signal,
  });
  if (!listed.ok) return listingFailure(listed, options);
  const registered = listed.commands.find(
    (command) => command.name === options.command,
  );
  if (!registered) {
    return {
      ...listed,
      ok: false,
      state: "unregistered",
      data: null,
      editorCommand: options.command,
      args: options.args ?? [],
      errors: [
        ...listed.errors,
        {
          code: "UNITY_COMMAND_NOT_REGISTERED",
          message: `The connected Editor has not registered ${options.command}.`,
        },
      ],
    };
  }
  const argumentResult = buildArguments(registered, options);
  if ("error" in argumentResult) {
    return {
      ...listed,
      ok: false,
      state: "error",
      data: null,
      editorCommand: options.command,
      args: [],
      errors: [
        ...listed.errors,
        {
          code: "UNITY_COMMAND_ARGUMENTS_INVALID",
          message: argumentResult.error,
        },
      ],
    };
  }

  const timeoutSeconds = options.timeoutSeconds ?? 30;
  const args = argumentResult.args;
  const result = await runUnityJson(
    runner,
    [
      ...unityJsonArgs,
      "command",
      "--project-path",
      options.projectPath,
      "--timeout",
      String(timeoutSeconds),
      options.command,
      ...(args.length ? ["--", ...args] : []),
    ],
    {
      signal: options.signal,
      timeoutMs: (timeoutSeconds + 5) * 1_000,
    },
  );
  return {
    ...result,
    state: result.ok
      ? "completed"
      : result.errors.some((error) => error.code === "UNITY_CLI_UNAVAILABLE")
        ? "unavailable"
        : "error",
    editorCommand: options.command,
    args,
  };
}

function listingFailure(
  listed: UnityListCommandsDetails,
  options: ExecuteUnityCommandOptions,
): UnityCommandDetails {
  return {
    ...listed,
    state:
      listed.state === "disconnected" || listed.state === "unavailable"
        ? listed.state
        : "error",
    editorCommand: options.command,
    args: options.args ?? [],
  };
}

function buildArguments(
  command: UnityRegisteredCommand,
  options: ExecuteUnityCommandOptions,
): { args: readonly string[] } | { error: string } {
  if (options.args && options.parameters) {
    return { error: "Use parameters or raw args, not both." };
  }
  if (!options.parameters) return { args: options.args ?? [] };

  const known = new Set(command.parameters.map(({ name }) => name));
  const unknown = Object.keys(options.parameters).filter(
    (name) => !known.has(name),
  );
  if (unknown.length) {
    return {
      error: `Unknown parameter${unknown.length === 1 ? "" : "s"} for ${command.name}: ${unknown.join(", ")}.`,
    };
  }
  const missing = command.parameters
    .filter(
      (parameter) =>
        parameter.required &&
        !Object.prototype.hasOwnProperty.call(
          options.parameters,
          parameter.name,
        ),
    )
    .map(({ name }) => name);
  if (missing.length) {
    return {
      error: `Missing required parameter${missing.length === 1 ? "" : "s"} for ${command.name}: ${missing.join(", ")}.`,
    };
  }

  const args: string[] = [];
  for (const parameter of command.parameters) {
    if (
      !Object.prototype.hasOwnProperty.call(options.parameters, parameter.name)
    ) {
      continue;
    }
    args.push(
      `--${parameter.name}`,
      serializeParameter(options.parameters[parameter.name]),
    );
  }
  return { args };
}

function serializeParameter(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "null";
}
