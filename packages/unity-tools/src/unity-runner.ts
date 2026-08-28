import { spawn } from "node:child_process";

export interface UnityRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UnityRunResult {
  ok: boolean;
  executable: string;
  args: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  aborted: boolean;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  spawnError?: string;
}

export interface UnityCommandRunner {
  run(
    args: readonly string[],
    options?: UnityRunOptions,
  ): Promise<UnityRunResult>;
}

export interface UnityRunnerOptions {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
}

export class UnityRunner implements UnityCommandRunner {
  readonly #executable: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #killGraceMs: number;

  constructor(options: UnityRunnerOptions = {}) {
    this.#executable = options.executable ?? "unity";
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    this.#killGraceMs = options.killGraceMs ?? 1_000;
  }

  run(
    args: readonly string[],
    options: UnityRunOptions = {},
  ): Promise<UnityRunResult> {
    const startedAt = performance.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let aborted = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError: string | undefined;
    let terminating = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const child = spawn(this.#executable, [...args], {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const terminate = () => {
      if (terminating || child.exitCode !== null || child.signalCode !== null)
        return;
      terminating = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(
        () => child.kill("SIGKILL"),
        this.#killGraceMs,
      );
      forceKillTimer.unref();
    };
    const abort = () => {
      aborted = true;
      terminate();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? this.#timeoutMs);
    timeout.unref();

    const capture = (target: Buffer[], chunk: Buffer) => {
      const remaining = this.#maxOutputBytes - outputBytes;
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining);
        target.push(captured);
        outputBytes += captured.byteLength;
      }
      if (chunk.byteLength > remaining) {
        outputLimitExceeded = true;
        terminate();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.once("error", (error) => (spawnError = error.message));
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    return new Promise((resolve) => {
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        options.signal?.removeEventListener("abort", abort);
        resolve({
          ok:
            exitCode === 0 &&
            !spawnError &&
            !aborted &&
            !timedOut &&
            !outputLimitExceeded,
          executable: this.#executable,
          args: [...args],
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          durationMs: Math.round(performance.now() - startedAt),
          aborted,
          timedOut,
          outputLimitExceeded,
          ...(spawnError ? { spawnError } : {}),
        });
      });
    });
  }
}
