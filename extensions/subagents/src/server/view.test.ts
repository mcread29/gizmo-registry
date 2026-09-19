import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseView, type View } from "@gizmo/extension-api";
import { writeSubagentState, writeSubagentThread } from "../state.ts";
import { gizmoExtension } from "./index.ts";

let agentDir: string;
let previousDir: string | undefined;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "subagents-view-"));
  previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
  rmSync(agentDir, { recursive: true, force: true });
});

function fakeContext() {
  const updates: View[] = [];
  return {
    updates,
    context: {
      workspacePath: "/ws",
      sessionId: "session-a",
      settings: {},
      update: (view: View) => updates.push(view),
    },
  };
}

function seed() {
  writeSubagentState(
    "session-a",
    [
      {
        id: "sa-1",
        title: "Explore",
        status: "running",
        cwd: "/ws",
        startedAt: Date.now(),
      },
    ],
    { workspacePath: "/ws", pid: process.pid },
  );
  writeSubagentThread("session-a", "sa-1", [
    { role: "user", text: "go" },
    { role: "assistant", text: "on it" },
  ]);
}

describe("subagents view", () => {
  it("pushes a valid view on open and clears its timer on dispose", async () => {
    vi.useFakeTimers();
    try {
      seed();
      const { updates, context } = fakeContext();
      const handle = await gizmoExtension.views.panel.open(context);
      expect(updates).toHaveLength(1);
      const view = updates[0]!;
      expect(parseView(view)).toEqual(view);
      expect(JSON.stringify(view)).toContain("sa-1");
      expect(view.badge).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      await handle.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the transcript of the selected subagent", async () => {
    seed();
    const { updates, context } = fakeContext();
    const handle = await gizmoExtension.views.panel.open(context);
    const result = await handle.action?.({
      actionId: "inspect",
      selection: { blockId: "subagents", itemId: "session-a:sa-1" },
      cancelled: false,
    });
    expect(result).toEqual({ status: "succeeded" });
    const view = updates.at(-1)!;
    expect(parseView(view)).toEqual(view);
    expect(JSON.stringify(view)).toContain("on it");
    await handle.dispose();
  });
});
