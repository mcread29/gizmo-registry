import { describe, expect, it, vi } from "vitest";
import { executeUnityCommand } from "./unity-command";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("Unity command execution", () => {
  it("executes an exact registered command in the selected project", async () => {
    const runner = sequenceRunner(
      jsonResult({
        data: { tools: [{ name: "console" }] },
        command: "list",
      }),
      jsonResult({
        data: { entries: [] },
        command: "command console",
      }),
    );

    const result = await executeUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "console",
      args: ["--tail", "1"],
      timeoutSeconds: 20,
    });

    expect(result.state).toBe("completed");
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      [
        "--non-interactive",
        "--no-banner",
        "--format",
        "json",
        "command",
        "--project-path",
        "/projects/game",
        "--timeout",
        "20",
        "console",
        "--",
        "--tail",
        "1",
      ],
      { signal: undefined, timeoutMs: 25_000 },
    );
  });

  it("never executes a command absent from the Editor registry", async () => {
    const runner = sequenceRunner(
      jsonResult({ data: { tools: [{ name: "console" }] }, command: "list" }),
    );

    const result = await executeUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "invented_command",
    });

    expect(result.state).toBe("unregistered");
    expect(result.errors[0]?.code).toBe("UNITY_COMMAND_NOT_REGISTERED");
    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("constructs arguments from the registered Editor schema", async () => {
    const runner = sequenceRunner(
      jsonResult({
        data: {
          tools: [
            {
              name: "create_script",
              parameters: [
                { name: "name", type: "string", required: true },
                { name: "overwrite", type: "bool", required: false },
                { name: "metadata", type: "jtoken", required: false },
              ],
            },
          ],
        },
        command: "list",
      }),
      jsonResult({ data: { path: "Player.cs" }, command: "create_script" }),
    );

    const result = await executeUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "create_script",
      parameters: {
        name: "Player",
        overwrite: true,
        metadata: { owner: "agent" },
      },
    });

    expect(result.state).toBe("completed");
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        "--name",
        "Player",
        "--overwrite",
        "true",
        "--metadata",
        '{"owner":"agent"}',
      ]),
      { signal: undefined, timeoutMs: 35_000 },
    );
  });

  it("rejects parameters that do not match the live schema", async () => {
    const runner = sequenceRunner(
      jsonResult({
        data: {
          tools: [
            {
              name: "create_script",
              parameters: [{ name: "name", type: "string", required: true }],
            },
          ],
        },
        command: "list",
      }),
    );

    const result = await executeUnityCommand(runner, {
      projectPath: "/projects/game",
      command: "create_script",
      parameters: { invented: true },
    });

    expect(result.errors).toEqual([
      expect.objectContaining({ code: "UNITY_COMMAND_ARGUMENTS_INVALID" }),
    ]);
    expect(runner.run).toHaveBeenCalledOnce();
  });
});

function sequenceRunner(...results: UnityRunResult[]): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => results.shift()!) };
}

function jsonResult({
  data,
  command,
}: {
  data: unknown;
  command: string;
}): UnityRunResult {
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
