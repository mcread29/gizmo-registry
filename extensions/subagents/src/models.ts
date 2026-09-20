/**
 * Live model discovery for the tier pickers.
 *
 * The panel's invoke lands in the agent-server process, not in Pi — but the
 * model list is not Pi's private state: anything that can read the agent dir
 * can rebuild the same registry (the agent-server does exactly that to run
 * sessions). So this builds a real ModelRuntime + ModelRegistry, refreshes it,
 * and returns the models whose provider actually has credentials configured.
 *
 * The registry is cached for a few minutes and doubles as the warm cache that
 * Pi used to write by hand; if a live read fails, the last good list is served
 * from disk instead of leaving the picker empty.
 */

import { join } from "node:path";
import {
  resolveAgentDir,
  subagentsDir,
} from "../../../packages/orchestration/src/agent-dir.ts";
import { readModelCatalog, writeModelCatalog } from "./tiers.ts";

const CACHE_TTL_MS = 10 * 60_000;

export interface ModelCatalogEntry {
  provider: string;
  id: string;
  name?: string;
}

/** The slice of the pi model registry this module needs. */
export interface ModelRegistryHandle {
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
  getAll(): Array<{ provider: string; id: string; name?: string }>;
  hasConfiguredAuth(model: { provider: string }): boolean;
}

export type RegistryFactory = (
  agentDir: string,
) => Promise<ModelRegistryHandle>;

export interface ModelListResult {
  models: ModelCatalogEntry[];
  source: "live" | "cache";
  updatedAt: number;
}

let cached: { registry: ModelRegistryHandle; at: number } | undefined;
let pending: Promise<ModelRegistryHandle> | undefined;

/** Drops the cached registry; the next read rebuilds it. Tests use this. */
export function resetModelRegistryCache(): void {
  cached = undefined;
  pending = undefined;
}

export async function listAvailableModels(
  options: {
    agentDir?: string;
    factory?: RegistryFactory;
    maxAgeMs?: number;
  } = {},
): Promise<ModelListResult> {
  const agentDir = options.agentDir ?? resolveAgentDir();
  try {
    const registry = await registryFor(
      agentDir,
      options.factory ?? defaultFactory,
      options.maxAgeMs ?? CACHE_TTL_MS,
    );
    const models = registry
      .getAll()
      .filter((model) => registry.hasConfiguredAuth(model))
      .map((model) => ({
        provider: model.provider,
        id: model.id,
        ...(model.name ? { name: model.name } : {}),
      }));
    writeModelCatalog(models, subagentsDir(agentDir));
    return { models, source: "live", updatedAt: Date.now() };
  } catch (error) {
    const fallback = readModelCatalog(subagentsDir(agentDir));
    if (fallback.length > 0) {
      return { models: fallback, source: "cache", updatedAt: Date.now() };
    }
    throw error;
  }
}

async function registryFor(
  agentDir: string,
  factory: RegistryFactory,
  maxAgeMs: number,
): Promise<ModelRegistryHandle> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.registry;
  pending ??= factory(agentDir)
    .then((registry) => {
      cached = { registry, at: Date.now() };
      return registry;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

async function defaultFactory(agentDir: string): Promise<ModelRegistryHandle> {
  const { ModelRegistry, ModelRuntime } =
    await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  const registry = new ModelRegistry(runtime);
  await registry.refresh({ allowNetwork: true });
  return registry;
}

function resolveDefaultAgentDir(): string {
  return subagentsDir().replace(/[/\\]subagents$/, "");
}
