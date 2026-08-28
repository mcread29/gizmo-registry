import {
  runUnityJson,
  unityJsonArgs,
  type UnityCliMessage,
  type UnityJsonDetails,
} from "./unity-json";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";
import { getUnityStatus, type UnityStatusDetails } from "./unity-status";

export interface UnityProject {
  title: string;
  path: string;
  version?: string;
  lastModified?: number;
  isFavorite: boolean;
  buildTarget?: string;
  renderPipeline?: string;
}

export interface UnityProjectsDetails extends UnityJsonDetails {
  projects: UnityProject[];
}

export interface UnityOpenProjectDetails extends UnityJsonDetails {
  state: "opened" | "already_open" | "error";
  status?: UnityStatusDetails;
}

export async function listUnityProjects(
  runner: UnityCommandRunner,
  signal?: AbortSignal,
): Promise<UnityProjectsDetails> {
  const result = await runUnityJson(
    runner,
    [...unityJsonArgs, "projects", "list", "--all", "--verbose"],
    { signal },
  );
  return { ...result, projects: normalizeProjects(result.data) };
}

export async function openUnityProject(
  runner: UnityCommandRunner,
  projectPath: string,
  signal?: AbortSignal,
): Promise<UnityOpenProjectDetails> {
  const status = await getUnityStatus(runner, { projectPath, signal });
  if (status.state === "connected") {
    return {
      state: "already_open",
      ok: true,
      command: status.command,
      exitCode: status.exitCode,
      durationMs: status.durationMs,
      data: null,
      errors: status.errors,
      warnings: status.warnings,
      status,
    };
  }

  // beta.5 emits no output and does not launch the Editor when `open` is used
  // with JSON formatting. Use its human output and normalize it for the API.
  const run = await runner.run(
    ["--non-interactive", "--no-banner", "open", projectPath],
    { signal, timeoutMs: 120_000 },
  );
  const result = openResult(run);
  return {
    ...result,
    state: result.ok ? "opened" : "error",
  };
}

function openResult(run: UnityRunResult): UnityJsonDetails {
  const output = [run.stderr.trim(), run.stdout.trim()]
    .filter(Boolean)
    .join("\n");
  let error: UnityCliMessage | undefined;
  if (run.spawnError) {
    error = { code: "UNITY_CLI_UNAVAILABLE", message: run.spawnError };
  } else if (run.aborted) {
    error = {
      code: "UNITY_CLI_ABORTED",
      message: "Unity CLI command was cancelled.",
    };
  } else if (run.timedOut) {
    error = {
      code: "UNITY_CLI_TIMEOUT",
      message: "Unity CLI command timed out.",
    };
  } else if (run.outputLimitExceeded) {
    error = {
      code: "UNITY_CLI_OUTPUT_LIMIT",
      message: "Unity CLI command exceeded the output limit.",
    };
  } else if (!run.ok || /^error:/im.test(output)) {
    error = {
      code: "UNITY_EDITOR_OPEN_FAILED",
      message:
        output.replace(/^error:\s*/i, "") ||
        "Unity Editor could not be opened.",
    };
  }
  return {
    ok: !error,
    command: [run.executable, ...run.args],
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    data: null,
    errors: error ? [error] : [],
    warnings: [],
    ...(run.stderr.trim() ? { stderr: run.stderr.trim() } : {}),
  };
}

function normalizeProjects(data: unknown): UnityProject[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const input = value as Record<string, unknown>;
    if (typeof input.title !== "string" || typeof input.path !== "string") {
      return [];
    }
    return [
      {
        title: input.title,
        path: input.path,
        ...(typeof input.version === "string"
          ? { version: input.version }
          : {}),
        ...(typeof input.lastModified === "number"
          ? { lastModified: input.lastModified }
          : {}),
        isFavorite: input.isFavorite === true,
        ...(typeof input.buildTarget === "string"
          ? { buildTarget: input.buildTarget }
          : {}),
        ...(typeof input.renderPipeline === "string"
          ? { renderPipeline: input.renderPipeline }
          : {}),
      },
    ];
  });
}
