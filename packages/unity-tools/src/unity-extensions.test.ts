import { describe, expect, it, vi } from "vitest";
import { invokeUnityExtension, listUnityExtensions } from "./unity-extensions";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("Unity extensions", () => {
  it("parses versioned descriptors without interpreting extension payloads", async () => {
    const runner = runnerReturning(
      commandResult({
        extensions: [
          {
            id: "com.gizmo.extras.console",
            name: "Console",
            version: "0.1.0",
            apiVersion: 1,
            capabilities: ["unity.console"],
            operations: [
              {
                id: "snapshot",
                mutates: false,
                requiresConfirmation: false,
              },
            ],
          },
        ],
      }),
    );

    const details = await listUnityExtensions(runner, "/projects/game");

    expect(details.extensions).toEqual([
      {
        id: "com.gizmo.extras.console",
        name: "Console",
        version: "0.1.0",
        apiVersion: 1,
        capabilities: ["unity.console"],
        operations: [
          {
            id: "snapshot",
            mutates: false,
            requiresConfirmation: false,
          },
        ],
      },
    ]);
  });

  it("returns an operation payload without knowing its shape", async () => {
    const runner = runnerReturning(commandResult({ arbitrary: ["payload"] }));

    await expect(
      invokeUnityExtension(
        runner,
        "/projects/game",
        "com.gizmo.extras.console",
        "snapshot",
        { tail: 20 },
      ),
    ).resolves.toEqual({ arbitrary: ["payload"] });
  });
});

function runnerReturning(result: UnityRunResult): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => result) };
}

function commandResult(result: unknown): UnityRunResult {
  return {
    ok: true,
    executable: "unity",
    args: [],
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({
      success: true,
      command: "command gizmo",
      data: { result },
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
