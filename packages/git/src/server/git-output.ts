/**
 * Runs git and reads only as much stdout as the caller can use.
 *
 * `execFile` buffers the whole output and fails the call outright once it
 * passes `maxBuffer`, so a working tree with a few megabytes of diff made
 * the status tool throw "stdout maxBuffer length exceeded" although only
 * the first 60 KB were ever shown to the model. Reading up to the cap and
 * stopping git there keeps the tool working on every repository.
 */

import { spawn } from "node:child_process";

export interface CappedOutput {
  text: string;
  /** Git had more to say than `limit`; the text ends where reading stopped. */
  truncated: boolean;
}

export interface CappedOptions {
  signal?: AbortSignal;
  /** Exit codes to treat as success besides 0 (`git diff --no-index` is 1). */
  acceptExitCodes?: readonly number[];
}

export function readGitOutput(
  cwd: string,
  args: string[],
  limit: number,
  options: CappedOptions = {},
): Promise<CappedOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--literal-pathspecs", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      resolve({ text, truncated });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const room = limit - size;
      if (chunk.length >= room) {
        out.push(chunk.subarray(0, room));
        size = limit;
        truncated = true;
        // Enough read: stop git rather than drain the rest of the diff.
        child.stdout.destroy();
        child.kill();
        finish(Buffer.concat(out).toString("utf8"));
        return;
      }
      out.push(chunk);
      size += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      const accepted =
        code === 0 || options.acceptExitCodes?.includes(code ?? -1);
      if (accepted) {
        finish(Buffer.concat(out).toString("utf8"));
        return;
      }
      settled = true;
      const stderr = Buffer.concat(err).toString("utf8").trim();
      reject(new Error(stderr || `git ${args[0]} exited with code ${code}`));
    });
  });
}
