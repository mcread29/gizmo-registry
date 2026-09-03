import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  readMergedSubagentState,
  stateFilePath,
  writeSubagentState,
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

test("an empty write removes the session's file", () => {
  writeSubagentState("session-a", [entry("sa-1", 1)], { agentDir });
  writeSubagentState("session-a", [], { agentDir });

  expect(existsSync(stateFilePath("session-a", agentDir))).toBe(false);
  expect(
    readMergedSubagentState({ agentDir, isProcessAlive: alive }).subagents,
  ).toEqual([]);
});
