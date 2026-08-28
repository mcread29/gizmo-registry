import { describe, expect, it, vi } from "vitest";
import { readUnityConsole } from "./unity-console";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("readUnityConsole", () => {
  it("normalizes entries and source locations from the connected Editor", async () => {
    const runner = fakeRunner(
      jsonResult({
        result: {
          entries: [
            {
              seq: 4,
              level: "warn",
              message: "Assets/Scripts/Player.cs(12,7): warning CS0414: unused",
              stackTrace: "",
            },
          ],
          cursor: 4,
          dropped: false,
        },
      }),
    );

    const details = await readUnityConsole(runner, {
      projectPath: "/projects/game",
      level: "warn",
      since: 2,
    });

    expect(details).toMatchObject({
      state: "completed",
      cursor: 4,
      entries: [
        {
          level: "warn",
          file: "Assets/Scripts/Player.cs",
          line: 12,
          column: 7,
        },
      ],
    });
    expect(runner.run).toHaveBeenCalledWith(
      expect.arrayContaining(["--since", "2"]),
      expect.anything(),
    );
  });
});

function fakeRunner(result: UnityRunResult): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => result) };
}

function jsonResult(result: unknown): UnityRunResult {
  return {
    ok: true,
    executable: "unity",
    args: [],
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({
      success: true,
      command: "command console",
      data: result,
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
