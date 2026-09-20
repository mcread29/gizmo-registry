import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  listAvailableModels,
  resetModelRegistryCache,
  type ModelRegistryHandle,
} from "./models.ts";
import { writeModelCatalog } from "./tiers.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "subagent-models-"));
  resetModelRegistryCache();
});

afterEach(() => {
  resetModelRegistryCache();
  rmSync(agentDir, { recursive: true, force: true });
});

function registry(
  models: { provider: string; id: string; name?: string }[],
  authenticated: string[],
): ModelRegistryHandle {
  return {
    refresh: vi.fn(async () => ({ aborted: false })),
    getAll: () => models,
    hasConfiguredAuth: (model) => authenticated.includes(model.provider),
  };
}

const models = [
  { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  { provider: "opencode-go", id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
  { provider: "anthropic", id: "claude-opus-4-7", name: "Claude Opus 4.7" },
];

test("offers only models whose provider has credentials", async () => {
  const factory = vi.fn(async () =>
    registry(models, ["openai-codex", "opencode-go"]),
  );

  const result = await listAvailableModels({ agentDir, factory });

  expect(result.source).toBe("live");
  expect(result.models.map((model) => `${model.provider}/${model.id}`)).toEqual(
    ["openai-codex/gpt-5.6-terra", "opencode-go/glm-5.3-flash"],
  );
  expect(result.models[0]?.name).toBe("GPT-5.6 Terra");
});

test("reuses one registry until the cache expires", async () => {
  const factory = vi.fn(async () => registry(models, ["openai-codex"]));

  await listAvailableModels({ agentDir, factory });
  await listAvailableModels({ agentDir, factory });
  expect(factory).toHaveBeenCalledTimes(1);

  await listAvailableModels({ agentDir, factory, maxAgeMs: -1 });
  expect(factory).toHaveBeenCalledTimes(2);
});

test("serves the last known list when a live read fails", async () => {
  writeModelCatalog(
    [{ provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" }],
    join(agentDir, "subagents"),
  );
  const factory = vi.fn(async () => {
    throw new Error("network unreachable");
  });

  const result = await listAvailableModels({ agentDir, factory });

  expect(result.source).toBe("cache");
  expect(result.models).toHaveLength(1);
});

test("propagates the failure when there is nothing cached", async () => {
  const factory = vi.fn(async () => {
    throw new Error("network unreachable");
  });

  await expect(listAvailableModels({ agentDir, factory })).rejects.toThrow(
    "network unreachable",
  );
});
