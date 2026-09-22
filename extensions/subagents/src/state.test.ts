import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  readMergedSubagentState,
  readSubagentThread,
  removeSubagentThreads,
  stateFilePath,
  threadFilePath,
  writeSubagentState,
  writeSubagentThread,
  type SubagentStateEntry,
} from "./state.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "subagent-state-"));
});

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

function entry(id: string, startedAt: number): SubagentStateEntry {
  return { id, title: id, status: "done", cwd: "/w", startedAt };
}

const alive = () => true;

test("entries from different sessions get distinct keys even with equal ids", () => {
  writeSubagentState("session-a", [entry("sa-1", 1)], { agentDir });
  writeSubagentState("session-b", [entry("sa-1", 2)], { agentDir });

  const merged = readMergedSubagentState({ agentDir, isProcessAlive: alive });

  expect(merged.subagents.map((sub) => sub.key)).toEqual([
    "session-b:sa-1",
    "session-a:sa-1",
  ]);
  expect(new Set(merged.subagents.map((sub) => sub.key)).size).toBe(2);
  expect(merged.subagents[0]?.sessionId).toBe("session-b");
});

test("the snapshot is scoped to the requested workspace", () => {
  writeSubagentState("session-a", [entry("sa-1", 1)], {
    agentDir,
    workspacePath: join(agentDir, "ProjectA"),
  });
  writeSubagentState("session-b", [entry("sa-1", 2)], {
    agentDir,
    workspacePath: join(agentDir, "ProjectB"),
  });
  // A file written before workspaces were recorded stays visible.
  writeSubagentState("legacy", [entry("sa-9", 3)], { agentDir });

  const merged = readMergedSubagentState({
    agentDir,
    workspacePath: `${join(agentDir, "ProjectA")}${process.platform === "win32" ? "\\" : "/"}`,
    isProcessAlive: alive,
  });

  expect(merged.subagents.map((sub) => sub.key)).toEqual([
    "legacy:sa-9",
    "session-a:sa-1",
  ]);
});

test("the snapshot can be narrowed to one thread", () => {
  writeSubagentState("thread-a", [entry("sa-1", 1)], { agentDir });
  writeSubagentState("thread-b", [entry("sa-1", 2)], { agentDir });

  const merged = readMergedSubagentState({
    agentDir,
    sessionId: "thread-a",
    isProcessAlive: alive,
  });

  expect(merged.subagents.map((sub) => sub.key)).toEqual(["thread-a:sa-1"]);
});

test("state left behind by a dead process is dropped and deleted", () => {
  writeSubagentState("live", [entry("sa-1", 1)], { agentDir, pid: 100 });
  writeSubagentState("dead", [entry("sa-1", 2)], { agentDir, pid: 200 });

  const merged = readMergedSubagentState({
    agentDir,
    isProcessAlive: (pid) => pid === 100,
  });

  expect(merged.subagents.map((sub) => sub.key)).toEqual(["live:sa-1"]);
  expect(existsSync(stateFilePath("dead", agentDir))).toBe(false);
  expect(existsSync(stateFilePath("live", agentDir))).toBe(true);
});

test("a structured transcript round-trips with its kinds and tool names", () => {
  writeSubagentThread(
    "session-a",
    "sa-1",
    [
      { role: "user", kind: "text", text: "first" },
      { role: "assistant", kind: "thinking", text: "hmm", at: 7 },
      { role: "assistant", kind: "toolCall", text: "src/a.ts", name: "read" },
      { role: "toolResult", kind: "toolResult", text: "ok", name: "read" },
    ],
    { agentDir },
  );

  const thread = readSubagentThread("session-a", "sa-1", agentDir);

  expect(thread?.messages).toEqual([
    { role: "user", kind: "text", text: "first" },
    { role: "assistant", kind: "thinking", text: "hmm", at: 7 },
    { role: "assistant", kind: "toolCall", text: "src/a.ts", name: "read" },
    { role: "toolResult", kind: "toolResult", text: "ok", name: "read" },
  ]);
  expect(thread?.sessionId).toBe("session-a");
});

test("a transcript written before kinds existed reads back as text", () => {
  mkdirSync(join(agentDir, "subagents", "threads"), { recursive: true });
  writeFileSync(
    threadFilePath("session-a", "sa-1", agentDir),
    JSON.stringify({
      sessionId: "session-a",
      id: "sa-1",
      updatedAt: 1,
      messages: [
        { role: "assistant", text: "old" },
        { role: "mystery", text: "who" },
      ],
    }),
    "utf8",
  );

  expect(readSubagentThread("session-a", "sa-1", agentDir)?.messages).toEqual([
    { role: "assistant", kind: "text", text: "old" },
    { role: "event", kind: "text", text: "who" },
  ]);
});

test("a snapshot carries the richer per-subagent fields", () => {
  const rich: SubagentStateEntry = {
    ...entry("sa-1", 1),
    model: "openai/gpt-5",
    thinkingLevel: "low",
    tier: "base",
    ladder: ["base: openai/gpt-5 · low", "mid: openai/gpt-5 · high"],
    turns: 3,
    toolCalls: 4,
    tokens: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1, total: 36 },
    cost: 0.12,
    sessionFile: "/home/u/.pi/sessions/sa-1.jsonl",
    prompt: "do the thing, at length",
    promptPreview: "do the thing",
    lastActivityAt: 42,
  };
  writeSubagentState("session-a", [rich], { agentDir });

  const merged = readMergedSubagentState({ agentDir, isProcessAlive: alive });

  expect(merged.subagents[0]).toMatchObject(rich);
});

test("a snapshot from an older writer still reads", () => {
  writeSubagentState("session-a", [entry("sa-1", 1)], { agentDir });

  const merged = readMergedSubagentState({ agentDir, isProcessAlive: alive });

  expect(merged.subagents[0]?.thinkingLevel).toBeUndefined();
  expect(merged.subagents[0]?.tokens).toBeUndefined();
});

test("one session's transcripts are removed without touching another's", () => {
  writeSubagentThread(
    "session-a",
    "sa-1",
    [{ role: "user", kind: "text", text: "a" }],
    { agentDir },
  );
  writeSubagentThread(
    "session-b",
    "sa-1",
    [{ role: "user", kind: "text", text: "b" }],
    { agentDir },
  );

  removeSubagentThreads("session-a", agentDir);

  expect(existsSync(threadFilePath("session-a", "sa-1", agentDir))).toBe(false);
  expect(readSubagentThread("session-b", "sa-1", agentDir)?.messages).toEqual([
    { role: "user", kind: "text", text: "b" },
  ]);
});

test("an empty write removes the session's file", () => {
  writeSubagentState("session-a", [entry("sa-1", 1)], { agentDir });
  writeSubagentState("session-a", [], { agentDir });

  expect(existsSync(stateFilePath("session-a", agentDir))).toBe(false);
  expect(
    readMergedSubagentState({ agentDir, isProcessAlive: alive }).subagents,
  ).toEqual([]);
});
