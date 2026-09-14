import { describe, expect, it, vi } from "vitest";
import { JobActiveError, JobRegistry } from "./jobs.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("JobRegistry", () => {
  it("tracks a job through success", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    const snapshot = registry.start("pull", "qwen3:8b", async (job, signal) => {
      expect(signal.aborted).toBe(false);
      job.setStage("downloading");
      job.setProgress({ completed: 50, total: 200 });
      await gate.promise;
      expect(signal.aborted).toBe(false);
    });
    await vi.waitFor(() => {
      expect(registry.snapshot("pull")?.percent).toBe(25);
    });
    gate.resolve();
    await vi.waitFor(() => {
      expect(registry.snapshot("pull")?.status).toBe("succeeded");
    });
    expect(registry.snapshot("pull")?.percent).toBe(100);
    expect(registry.snapshot("pull")?.finishedAt).toBeGreaterThan(
      snapshot.startedAt,
    );
  });

  it("records failures with the error message", async () => {
    const registry = new JobRegistry();
    registry.start("pull", "m", async () => {
      throw new Error("disk full");
    });
    await vi.waitFor(() => {
      const job = registry.snapshot("pull");
      expect(job?.status).toBe("failed");
      expect(job?.error).toBe("disk full");
    });
  });

  it("marks aborted jobs as cancelled", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    registry.start("pull", "m", async (_job, signal) => {
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      throw new Error("aborted");
    });
    expect(registry.cancel("pull")).toBe(true);
    gate.resolve();
    await vi.waitFor(() => {
      expect(registry.snapshot("pull")?.status).toBe("cancelled");
    });
    expect(registry.cancel("pull")).toBe(false);
  });

  it("rejects a second concurrent job of the same kind", async () => {
    const registry = new JobRegistry();
    const gate = deferred();
    registry.start("host", "install", async () => {
      await gate.promise;
    });
    expect(() => registry.start("host", "install", async () => {})).toThrow(
      JobActiveError,
    );
    // ...but a different kind runs independently
    expect(() => registry.start("pull", "m", async () => {})).not.toThrow();
    gate.resolve();
    await vi.waitFor(() =>
      expect(registry.snapshot("host")?.status).toBe("succeeded"),
    );
    // and once finished, the kind is free again — the old snapshot is replaced
    const replacement = registry.start("host", "update", async () => {});
    expect(replacement.target).toBe("update");
    await vi.waitFor(() =>
      expect(registry.snapshot("host")?.status).toBe("succeeded"),
    );
  });

  it("returns null before any job of a kind has run", () => {
    const registry = new JobRegistry();
    expect(registry.snapshot("pull")).toBeNull();
    expect(registry.snapshot("host")).toBeNull();
  });

  it("ignores progress updates after a job has finished", async () => {
    const registry = new JobRegistry();
    registry.start("pull", "m", async (job) => {
      job.setStage("done");
    });
    await vi.waitFor(() =>
      expect(registry.snapshot("pull")?.status).toBe("succeeded"),
    );
    expect(registry.snapshot("pull")?.stage).toBe("done");
  });
});
