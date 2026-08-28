import { describe, expect, it, vi } from "vitest";
import { createUnityWaitForCommandTool } from "./unity-wait-for-command-tool";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("unity_wait_for_command tool", () => {
  it("binds reload and discovery to the selected project", async () => {
    const runner = sequenceRunner(
      catalog("editor_status"),
      jsonResult("command editor_status", {
        result: { playMode: "stopped" },
      }),
      jsonResult("command console", {
        result: { entries: [], cursor: 1, dropped: false },
      }),
      catalog("recompile"),
      jsonResult("command recompile", {}),
      catalog("recompile_status"),
      jsonResult("command recompile_status", {
        result: JSON.stringify({
          status: "completed",
          failed: false,
          errors: [],
        }),
      }),
      jsonResult("command console", {
        result: { entries: [], cursor: 2, dropped: false },
      }),
      catalog("project_command"),
    );
    const tool = createUnityWaitForCommandTool({
      runner,
      projectPath: "/projects/game",
    });
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tool-1",
      { command: "project_command", timeoutSeconds: 10 },
      undefined,
      onUpdate,
      {} as never,
    );

    expect(result.details).toMatchObject({
      state: "ready",
      expectedCommand: "project_command",
    });
    expect(runner.run.mock.calls.flat().flat()).toContain("/projects/game");
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        { type: "text", text: "Verifying project_command registration" },
      ],
      details: undefined,
    });
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
