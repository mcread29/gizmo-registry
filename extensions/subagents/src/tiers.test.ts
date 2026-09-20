import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  ladderFrom,
  missingTiers,
  nextTier,
  readModelCatalog,
  readTiers,
  writeModelCatalog,
  writeTiers,
  type TierConfig,
} from "./tiers.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "subagent-tiers-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function config(): TierConfig {
  return {
    base: { provider: "openai-codex", model: "gpt-5.1-mini", effort: "low" },
    mid: { provider: "openai-codex", model: "gpt-5.6-terra", effort: "medium" },
    strong: { provider: "openai-codex", model: "gpt-6", effort: "high" },
  };
}

test("spawning stays unconfigured until all three tiers exist", () => {
  expect(readTiers(directory)).toBeUndefined();
  expect(missingTiers(undefined)).toEqual(["base", "mid", "strong"]);

  writeTiers(config(), directory);

  expect(readTiers(directory)).toEqual(config());
  expect(missingTiers(readTiers(directory))).toEqual([]);
});

test("a partial configuration is still missing tiers", () => {
  writeTiers(config(), directory);
  const path = join(directory, "tiers.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as {
    tiers: Record<string, unknown>;
  };
  delete file.tiers.strong;
  writeFileSync(path, JSON.stringify(file));

  expect(readTiers(directory)).toBeUndefined();
  expect(missingTiers(file.tiers)).toEqual(["strong"]);
});

test("the ladder only ever climbs", () => {
  expect(ladderFrom("base")).toEqual(["base", "mid", "strong"]);
  expect(ladderFrom("mid")).toEqual(["mid", "strong"]);
  expect(ladderFrom("strong")).toEqual(["strong"]);
  expect(nextTier("base")).toBe("mid");
  expect(nextTier("strong")).toBeUndefined();
});

test("the model catalog round-trips for the panel's pickers", () => {
  writeModelCatalog(
    [{ provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" }],
    directory,
  );

  expect(readModelCatalog(directory)).toEqual([
    { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  ]);
  expect(readModelCatalog(join(directory, "missing"))).toEqual([]);
});
