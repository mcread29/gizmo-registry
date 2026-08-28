import { executeUnityCommand, type UnityCommandDetails } from "./unity-command";
import { readUnityConsole, type UnityConsoleEntry } from "./unity-console";
import { unityDiagnostic } from "./unity-diagnostics";
import {
  asRecord,
  parseCommandResult,
  type UnityCliMessage,
  type UnityJsonDetails,
} from "./unity-json";
import type { UnityCommandRunner } from "./unity-runner";

export interface WaitForUnityCompileOptions {
  projectPath: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  confirmStopPlayMode?: () => Promise<boolean>;
}

export interface UnityCompileDetails extends UnityJsonDetails {
  state:
    | "ready"
    | "compile_failed"
    | "play_mode_active"
    | "disconnected"
    | "unavailable"
    | "timeout"
    | "error";
  attempts: number;
  compileStatus?: string;
  consoleEntries: UnityConsoleEntry[];
  consoleCursor?: number;
  compilationPending: false;
}

export function waitForUnityCompile(
  runner: UnityCommandRunner,
  options: WaitForUnityCompileOptions,
): Promise<UnityCompileDetails> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const startedAt = performance.now();
  let settled = false;

  return new Promise((resolve) => {
    const settle = (details: UnityCompileDetails) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      resolve(details);
    };
    const abort = () => {
      controller.abort();
      settle(
        interruptedDetails(
          "error",
          "UNITY_CLI_ABORTED",
          "Unity compilation was cancelled.",
          startedAt,
        ),
      );
    };
    const timeout = setTimeout(() => {
      controller.abort();
      settle(
        interruptedDetails(
          "timeout",
          "UNITY_COMPILE_TIMEOUT",
          `Unity did not finish compiling within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          startedAt,
        ),
      );
    }, timeoutMs);

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    waitForUnityCompileInternal(runner, {
      ...options,
      timeoutMs,
      signal: controller.signal,
    }).then(settle, (error: unknown) => {
      settle(
        interruptedDetails(
          "error",
          "UNITY_COMPILE_ERROR",
          error instanceof Error ? error.message : String(error),
          startedAt,
        ),
      );
    });
  });
}

/**
 * The CLI can remain pending while the Editor reloads its domain, and process
 * cancellation is not reliable enough to be the tool's deadline (notably on
 * Windows). Keep the workflow separate from the outer hard deadline so the
 * tool always produces a result even if an individual CLI invocation never
 * closes.
 */
async function waitForUnityCompileInternal(
  runner: UnityCommandRunner,
  options: WaitForUnityCompileOptions,
): Promise<UnityCompileDetails> {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const ready = await prepareEditorForCompile(runner, options);
  if (ready) return ready;
  const baseline = await readUnityConsole(runner, {
    projectPath: options.projectPath,
    tail: 1,
    level: "warn",
    signal: options.signal,
  });
  let attempts = 0;
  options.onProgress?.("Requesting Unity script recompile");
  let last: UnityCommandDetails = await executeUnityCommand(runner, {
    projectPath: options.projectPath,
    command: "recompile",
    signal: options.signal,
  });
  if (!last.ok) {
    return finish(
      runner,
      last,
      failureState(last),
      options,
      attempts,
      baseline.cursor,
    );
  }
  options.onProgress?.("Waiting for Unity compilation and domain reload");

  while (performance.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      return finish(runner, last, "error", options, attempts, baseline.cursor, [
        {
          code: "UNITY_CLI_ABORTED",
          message: "Unity compilation was cancelled.",
        },
      ]);
    }

    last = await executeUnityCommand(runner, {
      projectPath: options.projectPath,
      command: "recompile_status",
      signal: options.signal,
    });
    attempts++;
    if (last.ok) {
      const compile = compileResult(last.data);
      options.onProgress?.(
        compile.status
          ? `Unity compilation: ${compile.status}`
          : "Waiting for Unity compilation status",
      );
      if (compile.failed) {
        return finish(
          runner,
          last,
          "compile_failed",
          options,
          attempts,
          baseline.cursor,
          compile.errors.length
            ? compile.errors
            : [
                {
                  code: "UNITY_COMPILE_FAILED",
                  message: "Unity reported that script compilation failed.",
                },
              ],
          compile.status,
        );
      }
      if (compileComplete(compile.status)) {
        return finish(
          runner,
          last,
          "ready",
          options,
          attempts,
          baseline.cursor,
          last.errors,
          compile.status,
        );
      }
    }

    await wait(pollIntervalMs, options.signal);
  }

  return finish(runner, last, "timeout", options, attempts, baseline.cursor, [
    ...last.errors,
    {
      code: "UNITY_COMPILE_TIMEOUT",
      message: `Unity did not finish compiling within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
    },
  ]);
}

async function prepareEditorForCompile(
  runner: UnityCommandRunner,
  options: WaitForUnityCompileOptions,
): Promise<UnityCompileDetails | undefined> {
  let status = await executeUnityCommand(runner, {
    projectPath: options.projectPath,
    command: "editor_status",
    signal: options.signal,
  });
  if (!status.ok) {
    return finish(runner, status, failureState(status), options, 0);
  }
  const playMode = parseCommandResult(status.data)?.playMode;
  if (playMode !== "playing" && playMode !== "paused") return;

  options.onProgress?.("Waiting for permission to stop Play Mode");
  if (!(await options.confirmStopPlayMode?.())) {
    return finish(runner, status, "play_mode_active", options, 0, undefined, [
      {
        code: "UNITY_COMPILE_PLAY_MODE_ACTIVE",
        message:
          "Compilation was not started because Play Mode is active and the user chose to keep it running.",
      },
    ]);
  }

  options.onProgress?.("Stopping Unity Play Mode");
  status = await executeUnityCommand(runner, {
    projectPath: options.projectPath,
    command: "editor_stop",
    signal: options.signal,
  });
  if (!status.ok)
    return finish(runner, status, failureState(status), options, 0);

  const stopDeadline = performance.now() + 15_000;
  while (performance.now() < stopDeadline) {
    status = await executeUnityCommand(runner, {
      projectPath: options.projectPath,
      command: "editor_status",
      signal: options.signal,
    });
    if (!status.ok)
      return finish(runner, status, failureState(status), options, 0);
    if (parseCommandResult(status.data)?.playMode === "stopped") return;
    await wait(250, options.signal);
  }
  return finish(runner, status, "error", options, 0, undefined, [
    {
      code: "UNITY_PLAY_MODE_STOP_TIMEOUT",
      message: "Unity did not leave Play Mode within 15 seconds.",
    },
  ]);
}

async function finish(
  runner: UnityCommandRunner,
  details: UnityJsonDetails,
  state: UnityCompileDetails["state"],
  options: WaitForUnityCompileOptions,
  attempts: number,
  baselineCursor?: number,
  errors = details.errors,
  compileStatus?: string,
): Promise<UnityCompileDetails> {
  const console = await readUnityConsole(runner, {
    projectPath: options.projectPath,
    tail: 200,
    level: "warn",
    ...(baselineCursor === undefined ? {} : { since: baselineCursor }),
    signal: options.signal,
  });
  return {
    ...details,
    ok: state === "ready",
    state,
    attempts,
    ...(compileStatus ? { compileStatus } : {}),
    errors,
    consoleEntries: console.entries,
    ...(console.cursor === undefined ? {} : { consoleCursor: console.cursor }),
    compilationPending: false,
  };
}

function compileResult(data: unknown): {
  status?: string;
  failed: boolean;
  errors: UnityCliMessage[];
} {
  const details = parseCommandResult(data);
  return {
    ...(typeof details?.status === "string" ? { status: details.status } : {}),
    failed: details?.failed === true,
    errors: Array.isArray(details?.errors)
      ? details.errors
          .map(normalizeError)
          .filter((error) => error !== undefined)
      : [],
  };
}

function normalizeError(value: unknown): UnityCliMessage | undefined {
  if (typeof value === "string") return unityDiagnostic(value);
  const error = asRecord(value);
  if (!error) return;
  const message =
    typeof error.message === "string" ? error.message : JSON.stringify(value);
  const diagnostic = unityDiagnostic(
    message,
    typeof error.code === "string" ? error.code : undefined,
  );
  return {
    ...diagnostic,
    ...(typeof error.file === "string" ? { file: error.file } : {}),
    ...(positiveInteger(error.line) ? { line: error.line } : {}),
    ...(positiveInteger(error.column) ? { column: error.column } : {}),
  };
}

function compileComplete(status: string | undefined): boolean {
  return status === "completed" || status === "up_to_date";
}

function failureState(
  details: UnityCommandDetails,
): UnityCompileDetails["state"] {
  return details.state === "disconnected" || details.state === "unavailable"
    ? details.state
    : "error";
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function interruptedDetails(
  state: "timeout" | "error",
  code: string,
  message: string,
  startedAt: number,
): UnityCompileDetails {
  return {
    ok: false,
    state,
    attempts: 0,
    command: [],
    exitCode: null,
    durationMs: Math.round(performance.now() - startedAt),
    data: null,
    errors: [{ code, message }],
    warnings: [],
    consoleEntries: [],
    compilationPending: false,
  };
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(done, milliseconds);
    timeout.unref();
    const abort = () => {
      clearTimeout(timeout);
      done();
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
