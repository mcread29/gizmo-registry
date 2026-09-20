import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildSuccessorPrompt, traceDigest, type RunTrace } from "./handoff.ts";
import {
  formatEscalation,
  readEscalationJournal,
  writeEscalation,
  type EscalationEntry,
} from "./journal.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "subagent-handoff-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const trace: RunTrace = {
  task: "Survey every caller of parseSnapshot",
  notes: [
    "grep found 4 callers",
    "assistant: read src/web/subagents-runtime.svelte.ts",
    "[tool] grep",
  ],
  error: "Context limit reached before finishing",
};

test("the digest keeps the task, the activity, and the reason it stopped", () => {
  const digest = traceDigest(trace);

  expect(digest).toContain("Survey every caller of parseSnapshot");
  expect(digest).toContain("- grep found 4 callers");
  expect(digest).toContain("Why it stopped: Context limit reached");
});

test("the digest survives a run with nothing recorded", () => {
  expect(traceDigest({ task: "", notes: [] })).toContain("(no task recorded)");
});

test("the successor prompt carries the task and the hand-off", () => {
  const prompt = buildSuccessorPrompt("Survey the callers", {
    fromTier: "base",
    toTier: "mid",
    failure: "context limit reached",
    summary: "Found 3 of 4 callers before stopping.",
  });

  expect(prompt.startsWith("Survey the callers")).toBe(true);
  expect(prompt).toContain("## Hand-off from the base tier");
  expect(prompt).toContain("Found 3 of 4 callers before stopping.");
  expect(prompt).toContain("You are the mid tier");
  // The successor sees the original task, so it never starts blind.
  expect(prompt).toContain("Survey the callers");
});

function entry(overrides: Partial<EscalationEntry> = {}): EscalationEntry {
  return {
    at: 1_700_000_000_000,
    subagentId: "sa-1",
    title: "Survey callers",
    fromTier: "base",
    toTier: "mid",
    fromModel: "openai-codex/gpt-5.1-mini",
    toModel: "openai-codex/gpt-5.6-terra",
    failure: "context limit reached",
    summary: "Found 3 of 4 callers.",
    source: "compaction",
    ...overrides,
  };
}

test("escalations append to one journal per subagent", () => {
  writeEscalation("session-a", entry(), directory);
  writeEscalation(
    "session-a",
    entry({ fromTier: "mid", toTier: "strong", source: "digest" }),
    directory,
  );
  writeEscalation("session-b", entry({ subagentId: "sa-2" }), directory);

  const journal = readEscalationJournal("session-a", "sa-1", directory);
  expect(journal.map((climb) => `${climb.fromTier}→${climb.toTier}`)).toEqual([
    "base→mid",
    "mid→strong",
  ]);
  expect(journal[0]?.summary).toBe("Found 3 of 4 callers.");
  // Another subagent's journal is separate.
  expect(readEscalationJournal("session-a", "sa-2", directory)).toEqual([]);
  expect(readEscalationJournal("session-b", "sa-2", directory)).toHaveLength(1);
});

test("a journal entry renders as a readable climb", () => {
  const text = formatEscalation(entry());

  expect(text).toContain("### base → mid");
  expect(text).toContain(
    "openai-codex/gpt-5.1-mini → openai-codex/gpt-5.6-terra",
  );
  expect(text).toContain("Failed: context limit reached");
  expect(text).toContain("Found 3 of 4 callers.");
});

test("reading a journal that does not exist yields nothing", () => {
  expect(readEscalationJournal("missing", "sa-9", directory)).toEqual([]);
});
