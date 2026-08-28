import {
  listUnityCommands,
  type UnityRegisteredCommand,
} from "./unity-list-commands";
import type { UnityCommandRunner } from "./unity-runner";
import {
  waitForUnityCompile,
  type UnityCompileDetails,
  type WaitForUnityCompileOptions,
} from "./unity-wait-for-compile";

export interface WaitForUnityCommandOptions extends WaitForUnityCompileOptions {
  command: string;
}

export interface UnityCommandReloadDetails extends Omit<
  UnityCompileDetails,
  "state"
> {
  state: UnityCompileDetails["state"] | "command_missing";
  expectedCommand: string;
  registeredCommand?: UnityRegisteredCommand;
}

export async function waitForUnityCommand(
  runner: UnityCommandRunner,
  options: WaitForUnityCommandOptions,
): Promise<UnityCommandReloadDetails> {
  const compiled = await waitForUnityCompile(runner, options);
  if (!compiled.ok) {
    return { ...compiled, expectedCommand: options.command };
  }
  options.onProgress?.(`Verifying ${options.command} registration`);
  const catalog = await listUnityCommands(runner, {
    projectPath: options.projectPath,
    signal: options.signal,
  });
  const registeredCommand = catalog.commands.find(
    (command) => command.name === options.command,
  );
  if (registeredCommand) {
    return {
      ...compiled,
      command: catalog.command,
      exitCode: catalog.exitCode,
      durationMs: catalog.durationMs,
      data: catalog.data,
      warnings: catalog.warnings,
      expectedCommand: options.command,
      registeredCommand,
    };
  }
  return {
    ...compiled,
    ok: false,
    state: catalog.ok
      ? "command_missing"
      : catalog.state === "disconnected" || catalog.state === "unavailable"
        ? catalog.state
        : "error",
    command: catalog.command,
    exitCode: catalog.exitCode,
    durationMs: catalog.durationMs,
    data: catalog.data,
    warnings: catalog.warnings,
    errors: catalog.ok
      ? [
          ...catalog.errors,
          {
            code: "UNITY_COMMAND_NOT_REGISTERED_AFTER_RELOAD",
            message: `Unity finished compiling, but ${options.command} was not registered.`,
          },
        ]
      : catalog.errors,
    expectedCommand: options.command,
  };
}
