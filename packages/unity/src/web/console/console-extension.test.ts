import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../types";
import { ConsoleExtensionRuntime } from "./console-extension.svelte";

describe("ConsoleExtensionRuntime", () => {
  it("deduplicates polling and only marks a manual request busy", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const invoke = vi.fn(
      () => new Promise<unknown>((resolve) => pending.push(resolve)),
    );
    const runtime = new ConsoleExtensionRuntime({
      projectPath: "/projects/game",
      invoke,
    } satisfies ExtensionContext);

    const background = runtime.refresh(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(runtime.manualRefreshing).toBe(false);
    pending.shift()?.(snapshot());
    await background;

    const manual = runtime.refresh(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(runtime.manualRefreshing).toBe(true);
    pending.shift()?.(snapshot());
    await manual;
    expect(runtime.manualRefreshing).toBe(false);

    runtime.dispose();
  });

  it("keeps the last visible entries when a refresh returns an empty tail with nonzero counts", async () => {
    let revision = "a";
    const invoke = vi.fn(async (_method: string, input: unknown) => {
      const tail = (input as { tail: number }).tail;
      if (revision === "a") {
        return snapshot({
          revision,
          counts: { logs: 1, warnings: 0, errors: 0 },
          entries:
            tail === 1
              ? [{ seq: 1, message: "Ready" }]
              : [{ seq: 1, message: "Ready" }],
        });
      }
      return snapshot({
        revision,
        counts: { logs: 1, warnings: 0, errors: 0 },
        entries: [],
      });
    });
    const runtime = new ConsoleExtensionRuntime({
      projectPath: "/projects/game",
      invoke,
    } satisfies ExtensionContext);

    await runtime.refresh();
    expect(runtime.entries).toHaveLength(1);

    revision = "b";
    await runtime.refresh();

    expect(runtime.entries).toEqual([
      { seq: 1, level: "log", message: "Ready" },
    ]);
    expect(runtime.error).toBe("Console extension returned invalid data");
    runtime.dispose();
  });
});

function snapshot(
  overrides: Partial<{
    revision: string;
    counts: { logs: number; warnings: number; errors: number };
    entries: unknown[];
  }> = {},
) {
  return {
    state: "ready",
    counts: { logs: 0, warnings: 0, errors: 0 },
    entries: [],
    ...overrides,
  };
}
