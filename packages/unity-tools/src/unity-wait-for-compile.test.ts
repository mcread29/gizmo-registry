import { describe, expect, it } from "vitest";
import type { UnityCommandRunner } from "./unity-runner";
import { waitForUnityCompile } from "./unity-wait-for-compile";

const hangingRunner: UnityCommandRunner = {
  run: () => new Promise(() => {}),
};

describe("waitForUnityCompile", () => {
  it("returns at its deadline when a Unity CLI invocation never closes", async () => {
    const startedAt = performance.now();
    const result = await waitForUnityCompile(hangingRunner, {
      projectPath: "C:/UnityProject",
      timeoutMs: 25,
    });

    expect(result).toMatchObject({
      ok: false,
      state: "timeout",
      compilationPending: false,
      errors: [
        {
          code: "UNITY_COMPILE_TIMEOUT",
          message: "Unity did not finish compiling within 1 seconds.",
        },
      ],
    });
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it("returns immediately when cancellation cannot stop the CLI process", async () => {
    const controller = new AbortController();
    const pending = waitForUnityCompile(hangingRunner, {
      projectPath: "C:/UnityProject",
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      state: "error",
      errors: [{ code: "UNITY_CLI_ABORTED" }],
    });
  });
});
