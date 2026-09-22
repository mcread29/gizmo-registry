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
        model: "openai/gpt-5",
        thinkingLevel: "low",
        tier: "base",
        ladder: ["base: openai/gpt-5 · low"],
        turns: 2,
        toolCalls: 1,
        tokens: {
          input: 100,
          output: 20,
          cacheRead: 5,
          cacheWrite: 0,
          total: 125,
        },
        cost: 0.0123,
        sessionFile: "/home/u/.pi/sessions/sa-1.jsonl",
        prompt: "explore the repository thoroughly",
        promptPreview: "explore the repository",
      },
    ],
    { workspacePath: "/ws", pid: process.pid },
  );
  writeSubagentThread("session-a", "sa-1", [
    { role: "user", kind: "text", text: "go" },
    { role: "assistant", kind: "thinking", text: "planning" },
    { role: "assistant", kind: "toolCall", text: "src/a.ts", name: "read" },
    { role: "toolResult", kind: "toolResult", text: "file body", name: "read" },
    { role: "assistant", kind: "text", text: "on it" },
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

  it("lets a row click open its detail", async () => {
    seed();
    const { updates, context } = fakeContext();
    const handle = await gizmoExtension.views.panel.open(context);
    const view = updates[0]!;
    const list = view.blocks.find(
      (block) => block.type === "list" && block.id === "subagents",
    );
    expect(list).toMatchObject({ onSelect: "inspect" });
    expect(
      (list as { items: Array<Record<string, unknown>> }).items[0],
    ).toMatchObject({
      badge: { text: "B" },
      path: "/home/u/.pi/sessions/sa-1.jsonl",
    });
    expect(view.actions?.map((action) => action.id)).toContain("inspect");
    await handle.dispose();
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
    const json = JSON.stringify(view);
    // Detail fields.
    expect(json).toContain("Thinking level");
    expect(json).toContain("openai/gpt-5");
    expect(json).toContain("Tool calls");
    expect(json).toContain("Tokens");
    expect(json).toContain("Cost");
    expect(json).toContain("/home/u/.pi/sessions/sa-1.jsonl");
    expect(json).toContain("explore the repository thoroughly");
    // Transcript kinds.
    expect(json).toContain("thinking · planning");
    expect(json).toContain("[tool] read src/a.ts");
    expect(json).toContain("read: file body");
    expect(json).toContain("on it");
    await handle.dispose();
  });
});
