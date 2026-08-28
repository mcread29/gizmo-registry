import { describe, expect, it, vi } from "vitest";
import { listUnityCommands } from "./unity-list-commands";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("listUnityCommands", () => {
  it("extracts a registered command inventory", async () => {
    const runner = fakeRunner({
      stdout: JSON.stringify({
        success: true,
        command: "unity list",
        data: {
          commands: [
            { name: "scene.validate", description: "Validate the scene" },
          ],
        },
        errors: [],
        warnings: [],
      }),
    });

    const result = await listUnityCommands(runner, {
      projectPath: "/projects/game",
    });

    expect(runner.run).toHaveBeenCalledWith(
      [
        "--non-interactive",
        "--no-banner",
        "--format",
        "json",
        "list",
        "--project-path",
        "/projects/game",
      ],
      { signal: undefined },
    );
    expect(result).toMatchObject({
      state: "available",
      ok: true,
      commands: [{ name: "scene.validate" }],
    });
  });

  it("reports a disconnected Editor without throwing", async () => {
    const runner = fakeRunner({
      ok: false,
      exitCode: 6,
      stdout: JSON.stringify({
        success: false,
        command: "unity list",
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
    });

    await expect(listUnityCommands(runner)).resolves.toMatchObject({
      state: "disconnected",
      ok: false,
      commands: [],
      exitCode: 6,
    });
  });

  it("filters the normalized live schema without changing the CLI request", async () => {
    const runner = fakeRunner({
      stdout: JSON.stringify({
        success: true,
        command: "unity list",
        data: {
          tools: [
            {
              name: "create_script",
              description: "Create a C# script",
              group: "built-in",
              parameters: [{ name: "name", type: "string", required: true }],
            },
            { name: "editor_status", parameters: [] },
          ],
        },
        errors: [],
        warnings: [],
      }),
    });

    const result = await listUnityCommands(runner, {
      query: "script name",
      limit: 1,
    });

    expect(result).toMatchObject({
      totalCommands: 2,
      matchedCommands: 1,
      commands: [
        {
          name: "create_script",
          parameters: [{ name: "name", type: "string", required: true }],
        },
      ],
    });
    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("distinguishes an unavailable CLI", async () => {
    const runner = fakeRunner({
      ok: false,
      exitCode: null,
      spawnError: "spawn unity ENOENT",
    });

    await expect(listUnityCommands(runner)).resolves.toMatchObject({
      state: "unavailable",
      errors: [{ code: "UNITY_CLI_UNAVAILABLE" }],
    });
  });
});

function fakeRunner(overrides: Partial<UnityRunResult>): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(async () => ({
      ok: true,
      executable: "unity",
      args: [],
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 1,
      aborted: false,
      timedOut: false,
      outputLimitExceeded: false,
      ...overrides,
    })),
  };
}
