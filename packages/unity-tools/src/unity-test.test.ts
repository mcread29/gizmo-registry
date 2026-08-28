import { describe, expect, it, vi } from "vitest";
import { runUnityTests } from "./unity-test";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("runUnityTests", () => {
  it("normalizes a focused failed test with a linked source location", async () => {
    const runner = sequenceRunner(
      catalog("run_tests"),
      jsonResult("command run_tests", {
        result: { success: true, result: "running" },
      }),
      catalog("test_status"),
      jsonResult("command test_status", {
        result: JSON.stringify({
          status: "completed",
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            skipped: 0,
            inconclusive: 0,
          },
          results: [
            {
              fullName: "Game.PlayerTests.Jumps",
              status: "Failed",
              duration: 0.25,
              message: "Expected jump",
              stackTrace:
                "Game.PlayerTests.Jumps () (at Assets/Tests/PlayerTests.cs:42)",
            },
          ],
        }),
      }),
    );

    const details = await runUnityTests(runner, {
      projectPath: "/projects/game",
      mode: "editor",
      filter: "PlayerTests.Jumps",
    });

    expect(details).toMatchObject({
      ok: false,
      state: "failed",
      filter: "PlayerTests.Jumps",
      summary: { total: 1, failed: 1 },
      tests: [
        {
          name: "Game.PlayerTests.Jumps",
          status: "Failed",
          durationMs: 250,
          file: "Assets/Tests/PlayerTests.cs",
          line: 42,
        },
      ],
      errors: [{ code: "UNITY_TESTS_FAILED" }],
    });
    const runArguments = runner.run.mock.calls[1]?.[0] as string[];
    expect(runArguments).toContain("true");
  });
});

function sequenceRunner(...results: UnityRunResult[]): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => results.shift()!) };
}

function catalog(...commands: string[]): UnityRunResult {
  return jsonResult("list", {
    tools: commands.map((name) => ({
      name,
      parameters: [
        { name: "mode", type: "string", required: false },
        { name: "filter", type: "string", required: false },
        { name: "filter_type", type: "string", required: false },
        { name: "include_explicit", type: "bool", required: false },
        { name: "async_tests", type: "bool", required: false },
        { name: "timeout", type: "int", required: false },
      ],
    })),
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
