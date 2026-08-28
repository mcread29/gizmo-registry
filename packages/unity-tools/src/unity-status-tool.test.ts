import { describe, expect, it, vi } from "vitest";
import { createUnityStatusTool } from "./unity-status-tool";
import type { UnityCommandRunner } from "./unity-runner";

describe("unity_status tool", () => {
  it("returns model-readable text and structured UI details", async () => {
    const runner: UnityCommandRunner & { run: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async (args) => {
        return {
          ok: false,
          executable: "unity",
          args,
          exitCode: 6,
          signal: null,
          stdout: JSON.stringify({
            success: false,
            command: "status",
            data: { count: 0, instances: [] },
            errors: [
              {
                code: "STATUS_NO_INSTANCES",
                message: "No connected Editor.",
              },
            ],
            warnings: [],
          }),
          stderr: "",
          durationMs: 1,
          aborted: false,
          timedOut: false,
          outputLimitExceeded: false,
        };
      }),
    };
    const tool = createUnityStatusTool({
      runner,
      projectPath: "/projects/game",
    });

    const result = await tool.execute(
      "tool-1",
      {},
      undefined,
      undefined,
      {} as never,
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("STATUS_NO_INSTANCES"),
    });
    expect(result.details).toMatchObject({
      state: "disconnected",
      exitCode: 6,
    });
    expect(runner.run).toHaveBeenCalledWith(
      expect.arrayContaining(["--project-path", "/projects/game"]),
      { signal: undefined },
    );
  });
});
