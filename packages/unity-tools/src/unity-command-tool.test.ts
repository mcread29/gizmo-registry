import { describe, expect, it, vi } from "vitest";
import { createUnityCommandTool } from "./unity-command-tool";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("unity_command tool", () => {
  it("runs registered Editor commands without an approval callback", async () => {
    const runner = sequenceRunner(
      jsonResult("list", { tools: [{ name: "editor_status" }] }),
      jsonResult("command editor_status", { status: "ready" }),
    );
    const tool = createUnityCommandTool({
      runner,
      projectPath: "/projects/game",
    });

    const result = await tool.execute(
      "tool-1",
      { command: "editor_status" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.details).toMatchObject({
      state: "completed",
      editorCommand: "editor_status",
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});

function sequenceRunner(...results: UnityRunResult[]): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => results.shift()!) };
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
