import { describe, expect, it, vi } from "vitest";
import { waitForUnityCommand } from "./unity-wait-for-command";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("waitForUnityCommand", () => {
  it("waits through a reload and returns the newly registered schema", async () => {
    const runner = sequenceRunner(
      catalog("editor_status"),
      editorStatus("stopped"),
      consoleResult(10),
      catalog("recompile"),
      jsonResult("command recompile", { success: true }),
      disconnected(),
      catalog("recompile_status"),
      compileStatus("completed"),
      consoleResult(12),
      catalog("new_project_command"),
    );

    const result = await waitForUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "new_project_command",
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      state: "ready",
      expectedCommand: "new_project_command",
      attempts: 2,
      compileStatus: "completed",
      registeredCommand: { name: "new_project_command" },
    });
    expect(runner.run).toHaveBeenCalledTimes(10);
  });

  it("returns compiler diagnostics without checking the final catalog", async () => {
    const runner = sequenceRunner(
      catalog("editor_status"),
      editorStatus("stopped"),
      consoleResult(10),
      catalog("recompile"),
      jsonResult("command recompile", { success: true }),
      catalog("recompile_status"),
      compileStatus("completed", true, [
        "Assets/Editor/Test.cs(12,4): error CS1002: ; expected",
      ]),
      consoleResult(11),
    );

    const result = await waitForUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "broken_command",
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      state: "compile_failed",
      errors: [
        {
          code: "CS1002",
          message: expect.stringContaining("Test.cs"),
          file: "Assets/Editor/Test.cs",
          line: 12,
          column: 4,
        },
      ],
    });
    expect(runner.run).toHaveBeenCalledTimes(8);
  });

  it("distinguishes a successful compile from missing registration", async () => {
    const runner = sequenceRunner(
      catalog("editor_status"),
      editorStatus("stopped"),
      consoleResult(10),
      catalog("recompile"),
      jsonResult("command recompile", { success: true }),
      catalog("recompile_status"),
      compileStatus("up_to_date"),
      consoleResult(10),
      catalog("some_other_command"),
    );

    const result = await waitForUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "missing_command",
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      state: "command_missing",
      errors: [{ code: "UNITY_COMMAND_NOT_REGISTERED_AFTER_RELOAD" }],
    });
  });

  it("returns a precise result when the user keeps Play Mode running", async () => {
    const confirmStopPlayMode = vi.fn(async () => false);
    const runner = sequenceRunner(
      catalog("editor_status"),
      editorStatus("playing"),
      consoleResult(10),
    );

    const result = await waitForUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "new_project_command",
      confirmStopPlayMode,
    });

    expect(confirmStopPlayMode).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      state: "play_mode_active",
      errors: [{ code: "UNITY_COMPILE_PLAY_MODE_ACTIVE" }],
    });
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it("stops Play Mode before compiling when the user accepts", async () => {
    const confirmStopPlayMode = vi.fn(async () => true);
    const runner = sequenceRunner(
      catalog("editor_status"),
      editorStatus("playing"),
      catalog("editor_stop"),
      jsonResult("command editor_stop", { result: {} }),
      catalog("editor_status"),
      editorStatus("stopped"),
      consoleResult(10),
      catalog("recompile"),
      jsonResult("command recompile", { success: true }),
      catalog("recompile_status"),
      compileStatus("completed"),
      consoleResult(11),
      catalog("new_project_command"),
    );

    const result = await waitForUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "new_project_command",
      pollIntervalMs: 0,
      confirmStopPlayMode,
    });

    expect(confirmStopPlayMode).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, state: "ready" });
    expect(runner.run.mock.calls.flat().flat()).toContain("editor_stop");
  });
});

function sequenceRunner(...results: UnityRunResult[]): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => results.shift()!) };
}

function catalog(...commands: string[]): UnityRunResult {
  return jsonResult("list", {
    tools: commands.map((name) => ({ name, parameters: [] })),
  });
}

function compileStatus(
  status: string,
  failed = false,
  errors: unknown[] = [],
): UnityRunResult {
  return jsonResult("command recompile_status", {
    result: JSON.stringify({ status, failed, errors }),
  });
}

function editorStatus(playMode: string): UnityRunResult {
  return jsonResult("command editor_status", {
    result: { playMode },
  });
}

function disconnected(): UnityRunResult {
  return {
    ...jsonResult("list", null),
    ok: false,
    exitCode: 6,
    stdout: JSON.stringify({
      success: false,
      command: "list",
      data: null,
      errors: [
        {
          code: "COMMAND_FAILED",
          message:
            "No Unity Editor instances found with reachable Pipeline servers.",
        },
      ],
      warnings: [],
    }),
  };
}

function consoleResult(cursor: number): UnityRunResult {
  return jsonResult("command console", {
    result: { entries: [], cursor, returned: 0, dropped: false },
  });
}

function jsonResult(command: string, data: unknown): UnityRunResult {
  return {
    ok: true,
    executable: "unity",
    args: [],
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({
      success: true,
      command,
      data,
      errors: [],
      warnings: [],
    }),
    stderr: "",
    durationMs: 1,
    aborted: false,
    timedOut: false,
    outputLimitExceeded: false,
  };
}
