import { describe, expect, it } from "vitest";
import { UnityRunner } from "./unity-runner";

describe("UnityRunner", () => {
  it("captures stdout from a successful process", async () => {
    const runner = nodeRunner();
    const result = await runner.run([
      "-e",
      "process.stdout.write(JSON.stringify({ success: true }))",
    ]);

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: '{"success":true}',
      stderr: "",
    });
  });

  it("preserves stderr and nonzero exit codes", async () => {
    const runner = nodeRunner();
    const result = await runner.run([
      "-e",
      "process.stderr.write('failed'); process.exitCode = 6",
    ]);

    expect(result).toMatchObject({
      ok: false,
      exitCode: 6,
      stderr: "failed",
    });
  });

  it("terminates a process after its timeout", async () => {
    const runner = nodeRunner({ timeoutMs: 20 });
    const result = await runner.run(["-e", "setInterval(() => {}, 1000)"]);

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGTERM");
  });

  it("returns after forced termination when a descendant keeps stdio open", async () => {
    const runner = nodeRunner({ timeoutMs: 20, killGraceMs: 20 });
    const result = await runner.run([
      "-e",
      `const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], { stdio: ["ignore", process.stdout, process.stderr] });
setInterval(() => {}, 1000);`,
    ]);

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(300);
  });

  it("cancels a process with an AbortSignal", async () => {
    const runner = nodeRunner();
    const controller = new AbortController();
    const pending = runner.run(["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.signal).toBe("SIGTERM");
  });

  it("reports an unavailable executable", async () => {
    const runner = new UnityRunner({
      executable: "/definitely/missing/unity",
    });
    const result = await runner.run([]);

    expect(result.ok).toBe(false);
    expect(result.spawnError).toContain("ENOENT");
  });
});

function nodeRunner(
  options: { timeoutMs?: number; killGraceMs?: number } = {},
) {
  return new UnityRunner({ executable: process.execPath, ...options });
}
