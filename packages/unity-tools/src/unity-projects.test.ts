import { describe, expect, it, vi } from "vitest";
import { listUnityProjects, openUnityProject } from "./unity-projects";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

describe("Unity projects", () => {
  it("normalizes only project fields used by the application", async () => {
    const runner = sequenceRunner(
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "projects",
          data: [
            {
              title: "Game",
              path: "/projects/game",
              version: "6000.3.10f1",
              lastModified: 123,
              isFavorite: true,
              buildTarget: "StandaloneLinux64",
              renderPipeline: "URP",
              cloudProjectId: "not-forwarded",
            },
          ],
          errors: [],
          warnings: [],
        }),
      }),
    );

    const result = await listUnityProjects(runner);

    expect(runner.run).toHaveBeenCalledWith(
      [
        "--non-interactive",
        "--no-banner",
        "--format",
        "json",
        "projects",
        "list",
        "--all",
        "--verbose",
      ],
      { signal: undefined },
    );
    expect(result.projects).toEqual([
      {
        title: "Game",
        path: "/projects/game",
        version: "6000.3.10f1",
        lastModified: 123,
        isFavorite: true,
        buildTarget: "StandaloneLinux64",
        renderPipeline: "URP",
      },
    ]);
  });

  it("does not launch a second Editor for an already-open project", async () => {
    const runner = sequenceRunner(
      runResult({
        stdout: statusJson({
          success: true,
          instances: [{ projectPath: "/projects/game" }],
        }),
      }),
    );

    const result = await openUnityProject(runner, "/projects/game");

    expect(result.state).toBe("already_open");
    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("opens the exact selected path when it is not already connected", async () => {
    const runner = sequenceRunner(
      runResult({
        ok: false,
        exitCode: 6,
        stdout: statusJson({
          success: false,
          instances: [],
          errors: [{ code: "STATUS_NO_INSTANCES", message: "No instances." }],
        }),
      }),
      runResult({
        stdout: JSON.stringify({
          success: true,
          command: "open",
          data: { projectPath: "/projects/game" },
          errors: [],
          warnings: [],
        }),
      }),
    );

    const result = await openUnityProject(runner, "/projects/game");

    expect(result.state).toBe("opened");
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      ["--non-interactive", "--no-banner", "open", "/projects/game"],
      { signal: undefined, timeoutMs: 120_000 },
    );
  });

  it("recognizes an Editor failure hidden behind a zero CLI exit code", async () => {
    const runner = sequenceRunner(
      runResult({
        ok: false,
        exitCode: 6,
        stdout: statusJson({ success: false, instances: [] }),
      }),
      runResult({ stdout: "Error: Editor exited with code 1\n" }),
    );

    const result = await openUnityProject(runner, "/projects/game");

    expect(result.state).toBe("error");
    expect(result.errors[0]?.message).toBe("Editor exited with code 1");
  });
});

function sequenceRunner(...results: UnityRunResult[]): UnityCommandRunner & {
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

function statusJson({
  success,
  instances,
  errors = [],
}: {
  success: boolean;
  instances: unknown[];
  errors?: unknown[];
}) {
  return JSON.stringify({
    success,
    command: "status",
    data: { count: instances.length, instances },
    errors,
    warnings: [],
  });
}
