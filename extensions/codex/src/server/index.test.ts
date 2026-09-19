import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { parseView, type View } from "@gizmo/extension-api";
import { gizmoExtension, setUsageSource } from "./index.ts";

function fakeContext() {
  const updates: View[] = [];
  return {
    updates,
    context: {
      workspacePath: "/ws",
      settings: {},
      update: (view: View) => updates.push(view),
    },
  };
}

describe("codex view", () => {
  beforeEach(() => {
    setUsageSource({
      getUsage: async () => ({
        fetchedAt: 0,
        planType: "pro",
        email: "user@example.com",
        limitReached: false,
        primary: {
          usedPercent: 12,
          windowSeconds: 18_000,
          resetAfterSeconds: 600,
        },
        secondary: null,
        additional: [],
        credits: null,
      }),
    });
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await gizmoExtension.dispose?.();
    vi.useRealTimers();
  });

  it("pushes a valid view when opened and clears its timer on dispose", async () => {
    const { updates, context } = fakeContext();
    const handle = await gizmoExtension.views.usage.open(context);
    expect(updates).toHaveLength(1);
    expect(parseView(updates[0])).toEqual(updates[0]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-renders when the email toggle is used", async () => {
    const { updates, context } = fakeContext();
    const handle = await gizmoExtension.views.usage.open(context);
    const result = await handle.action?.({
      actionId: "toggle-email",
      cancelled: false,
    });
    expect(result).toEqual({ status: "succeeded" });
    expect(updates.length).toBeGreaterThan(1);
    expect(JSON.stringify(updates.at(-1))).toContain("Hide email");
    await handle.dispose();
  });
});
