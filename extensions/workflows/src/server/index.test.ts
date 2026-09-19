import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseView, type View } from "@gizmo/extension-api";
import { workflowRunsDir } from "../../../../packages/orchestration/src/agent-dir.ts";
import { effectiveStatus, gizmoExtension, listRuns, readRun } from "./index.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "workflow-runs-"));
});

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

function writeRun(
  runId: string,
  details: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const dir = join(workflowRunsDir(agentDir), runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "workflow.json"),
    JSON.stringify({ runId, agents: [], status: "completed", ...details }),
  );
  for (const [name, value] of Object.entries(extra)) {
    writeFileSync(join(dir, name), JSON.stringify(value));
  }
}

const workspace = join(tmpdir(), "ProjectA");

test("runs are scoped to the open thread and its workspace", () => {
  writeRun("wf_a1", { sessionId: "thread-a", cwd: workspace, startedAt: 1 });
  writeRun("wf_a2", { sessionId: "thread-a", cwd: workspace, startedAt: 2 });
  writeRun("wf_b1", { sessionId: "thread-b", cwd: workspace, startedAt: 3 });
  writeRun("wf_a3", {
    sessionId: "thread-a",
    cwd: join(tmpdir(), "ProjectB"),
    startedAt: 4,
  });
  // A run from before cwd tracking is pinned by its session alone.
  writeRun("wf_a0", { sessionId: "thread-a", startedAt: 0 });

  const runs = listRuns(
    `${workspace}${process.platform === "win32" ? "\\" : "/"}`,
    { sessionId: "thread-a" },
    agentDir,
  );

  expect(runs.map((run) => run.runId)).toEqual(["wf_a2", "wf_a1", "wf_a0"]);
});

test("without a thread there is nothing to list", () => {
  writeRun("wf_a1", { sessionId: "thread-a", cwd: workspace });
  expect(listRuns(workspace, {}, agentDir)).toEqual([]);
  expect(listRuns(workspace, undefined, agentDir)).toEqual([]);
});

test("a running workflow whose heartbeat stopped is reported as aborted", () => {
  const now = 1_000_000;
  expect(
    effectiveStatus({ status: "running", updatedAt: now - 5_000 }, now),
  ).toBe("running");
  expect(
    effectiveStatus({ status: "running", updatedAt: now - 120_000 }, now),
  ).toBe("aborted");
  expect(
    effectiveStatus({ status: "running", startedAt: now - 120_000 }, now),
  ).toBe("aborted");
  expect(
    effectiveStatus({ status: "completed", updatedAt: now - 120_000 }, now),
  ).toBe("completed");
});

test("run rehydrates the stored result instead of the marker", () => {
  writeRun(
    "wf_r1",
    {
      sessionId: "thread-a",
      result: "[stored in result.json]",
      resultArtifact: "result.json",
    },
    { "result.json": { confirmed: ["x"] } },
  );

  expect(readRun("wf_r1", agentDir).result).toEqual({ confirmed: ["x"] });
});

test("the view pushes a valid run list and clears its timer on dispose", async () => {
  writeRun("wf_v1", {
    sessionId: "thread-a",
    cwd: workspace,
    startedAt: 1,
    name: "Review",
    agents: [
      { index: 0, label: "reader", state: "done", startedAt: 1, usage: {} },
    ],
  });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  vi.useFakeTimers();
  try {
    const updates: View[] = [];
    const handle = await gizmoExtension.views.panel.open({
      workspacePath: workspace,
      sessionId: "thread-a",
      settings: {},
      update: (view: View) => updates.push(view),
    });
    expect(updates).toHaveLength(1);
    expect(parseView(updates[0])).toEqual(updates[0]);
    expect(JSON.stringify(updates[0])).toContain("Review");
    expect(vi.getTimerCount()).toBe(1);

    const result = await handle.action?.({
      actionId: "open-run",
      selection: { blockId: "runs", itemId: "wf_v1" },
      cancelled: false,
    });
    expect(result).toEqual({ status: "succeeded" });
    const detail = updates.at(-1)!;
    expect(parseView(detail)).toEqual(detail);
    expect(JSON.stringify(detail)).toContain("reader");

    await handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
