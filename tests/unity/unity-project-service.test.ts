import type { UnityCommandRunner, UnityRunResult } from "@gizmo/unity-tools";
import { describe, expect, it, vi } from "vitest";
import { UnityProjectService } from "@gizmo/unity/server";
import { UnityExtensionProvider } from "@gizmo/unity/server";

describe("UnityProjectService", () => {
  it("rejects paths outside the Unity project registry before status or open", async () => {
    const runner = runnerReturning(
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "projects list",
          data: [
            {
              title: "Registered",
              path: "/projects/registered",
              isFavorite: false,
            },
          ],
          errors: [],
          warnings: [],
        }),
      }),
    );
    const service = new UnityProjectService(runner);

    await service.listProjects();
    await expect(service.openProject("/tmp/not-registered")).rejects.toThrow(
      "not a Unity project",
    );

    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("checks status for the exact registered project path", async () => {
    const runner = runnerReturning(
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "projects list",
          data: [
            {
              title: "Game",
              path: "/projects/game",
              isFavorite: false,
            },
          ],
          errors: [],
          warnings: [],
        }),
      }),
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "status",
          data: { count: 1, instances: [{ projectPath: "/projects/game" }] },
          errors: [],
          warnings: [],
        }),
      }),
    );
    const service = new UnityProjectService(runner);

    await service.listProjects();
    const status = await service.getStatus("/projects/game");

    expect(status.state).toBe("connected");
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["--project-path", "/projects/game"]),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("discovers extension entrypoints without invoking missing commands", async () => {
    const runner = runnerReturning(
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "list",
          data: { tools: [{ name: "console" }] },
          errors: [],
          warnings: [],
        }),
      }),
    );
    const provider = new UnityExtensionProvider(runner);
    const extensions = await provider.list("/projects/game");

    expect(extensions).toEqual([]);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls.flatMap(([args]) => args)).not.toContain(
      "gizmo_extensions",
    );
  });

  it("exposes Unity as one extension while forwarding its Console capability", async () => {
    const runner = runnerReturning(
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "list",
          data: { tools: [{ name: "gizmo_extensions" }] },
          errors: [],
          warnings: [],
        }),
      }),
      runResult({
        stdout: extensionResult({
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
      }),
      runResult({ stdout: extensionResult({ opaque: true }) }),
    );
    const provider = new UnityExtensionProvider(runner);
    await provider.list("/projects/game");
    await expect(
      provider.invoke("/projects/game", "unity", "console.snapshot", {
        tail: 1,
      }),
    ).resolves.toEqual({ opaque: true });

    expect(runner.run.mock.calls.flatMap(([args]) => args)).toContain(
      "gizmo_extension_invoke",
    );
  });

  it("emits only changed project status while watching", async () => {
    const runner = runnerReturning(
      projectsResult(),
      statusResult([{ projectPath: "/projects/game", state: "ready" }]),
      statusResult([]),
    );
    const service = new UnityProjectService(runner, 1);
    const changed = new Promise<string>((resolve) => {
      void service.watchStatus("/projects/game", {
        status: (status) => resolve(status.state),
      });
    });

    await expect(changed).resolves.toBe("disconnected");
    service.dispose();
  });

  it("refuses to revert a file outside the project", async () => {
    const service = new UnityProjectService(runnerReturning(projectsResult()));
    await service.listProjects();

    await expect(
      service.revertFile(
        "/projects/game",
        "../../etc/hosts",
        "@@ -1 +1 @@\n-a\n+b",
      ),
    ).rejects.toThrow("outside the selected project");
  });
});

function projectsResult(): UnityRunResult {
  return runResult({
    stdout: JSON.stringify({
      success: true,
      command: "projects list",
      data: [
        {
          title: "Game",
          path: "/projects/game",
          isFavorite: false,
        },
      ],
      errors: [],
      warnings: [],
    }),
  });
}

function statusResult(instances: Record<string, unknown>[]): UnityRunResult {
  return runResult({
    ok: instances.length > 0,
    exitCode: instances.length > 0 ? 0 : 6,
    stdout: JSON.stringify({
      success: instances.length > 0,
      command: "status",
      data: { count: instances.length, instances },
      errors: instances.length
        ? []
        : [
            {
              code: "STATUS_NO_INSTANCES",
              message: "No Unity Editor instances found.",
            },
          ],
      warnings: [],
    }),
  });
}

function extensionResult(result: unknown): string {
  return JSON.stringify({
    success: true,
    command: "command gizmo",
    data: { result },
    errors: [],
    warnings: [],
  });
}

function runnerReturning(...results: UnityRunResult[]): UnityCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return { run: vi.fn(async () => results.shift()!) };
}

function runResult(overrides: Partial<UnityRunResult>): UnityRunResult {
  return {
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
  };
}
