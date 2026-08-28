import { describe, expect, it, vi } from "vitest";
import { getUnityStatus, unityStatusArgs } from "./unity-status";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("getUnityStatus", () => {
  it("returns connected Editor instances from structured output", async () => {
    const runner = fakeRunner({
      stdout: JSON.stringify({
        success: true,
        command: "status",
        data: {
          count: 1,
          instances: [
            {
              port: 6400,
              projectPath: "/projects/game",
              version: "6000.3.7f1",
              pid: 42,
              state: "ready",
            },
          ],
        },
        errors: [],
        warnings: [],
      }),
    });

    const status = await getUnityStatus(runner);

    expect(runner.run).toHaveBeenCalledWith(unityStatusArgs, {
      signal: undefined,
    });
    expect(status).toMatchObject({
      state: "connected",
      ok: true,
      exitCode: 0,
      instances: [{ projectPath: "/projects/game" }],
    });
  });

  it("preserves the CLI no-instance diagnostic as a disconnected state", async () => {
    const runner = fakeRunner({
      ok: false,
      exitCode: 6,
      stdout: JSON.stringify({
        success: false,
        command: "status",
        data: { count: 0, instances: [] },
        errors: [
          {
            code: "STATUS_NO_INSTANCES",
            message: "No Unity Editor instances found.",
          },
        ],
        warnings: [],
      }),
    });

    await expect(getUnityStatus(runner)).resolves.toMatchObject({
      state: "disconnected",
      ok: false,
      exitCode: 6,
      errors: [{ code: "STATUS_NO_INSTANCES" }],
    });
  });

  it("reports malformed JSON without throwing", async () => {
    const runner = fakeRunner({ stdout: "not json" });

    await expect(getUnityStatus(runner)).resolves.toMatchObject({
      state: "error",
      errors: [{ code: "UNITY_CLI_INVALID_JSON" }],
    });
  });

  it("reports timeout and cancellation distinctly", async () => {
    const timedOut = fakeRunner({ ok: false, timedOut: true });
    const aborted = fakeRunner({ ok: false, aborted: true });

    await expect(getUnityStatus(timedOut)).resolves.toMatchObject({
      errors: [{ code: "UNITY_CLI_TIMEOUT" }],
    });
    await expect(getUnityStatus(aborted)).resolves.toMatchObject({
      errors: [{ code: "UNITY_CLI_ABORTED" }],
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
      args: unityStatusArgs,
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
