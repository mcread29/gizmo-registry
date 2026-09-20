/**
 * Subagent tier configuration: three model/effort rungs the extension draws
 * from instead of inheriting the parent's model.
 *
 * Delegation is a cost decision, so it is made once, on purpose: subagents
 * stay disabled until all three rungs are chosen. A spawn names the rung it
 * starts on (default `base`) and the run climbs the ladder only when a rung
 * actually fails — everyday work never starts at the strongest model.
 *
 * Shared by the Pi side (which resolves and spawns), the agent-server side
 * (which serves the config to the panel), and the panel itself, so it imports
 * nothing but node built-ins and the agent-dir helper.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subagentsDir } from "../../../packages/orchestration/src/agent-dir.ts";

export const TIERS = ["base", "mid", "strong"] as const;
export type Tier = (typeof TIERS)[number];

export const EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type Effort = (typeof EFFORTS)[number];

/** One rung: which model runs it, and at what thinking level. */
export interface TierSetting {
  provider: string;
  model: string;
  effort: Effort;
}

/** All three rungs. Only complete configurations enable spawning. */
export type TierConfig = Record<Tier, TierSetting>;

export interface TierFile {
  updatedAt: number;
  tiers: Partial<Record<Tier, TierSetting>>;
}

/** A model the parent session can see, offered to the tier pickers. */
export interface ModelOption {
  provider: string;
  id: string;
  name?: string;
}

export interface ModelCatalog {
  updatedAt: number;
  models: ModelOption[];
}

const TIERS_FILE = "tiers.json";
const MODELS_FILE = "models.json";

export function tiersFilePath(dir = subagentsDir()): string {
  return join(dir, TIERS_FILE);
}

export function modelsFilePath(dir = subagentsDir()): string {
  return join(dir, MODELS_FILE);
}

export function isTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

export function isEffort(value: unknown): value is Effort {
  return EFFORTS.includes(value as Effort);
}

/** The rung above `tier`, or undefined at the top of the ladder. */
export function nextTier(tier: Tier): Tier | undefined {
  return TIERS[TIERS.indexOf(tier) + 1];
}

/** Rungs from `tier` upward — the escalation path a spawn gets. */
export function ladderFrom(tier: Tier): Tier[] {
  return TIERS.slice(TIERS.indexOf(tier));
}

export function tierLabel(tier: Tier): string {
  return { base: "Base", mid: "Mid", strong: "Strong" }[tier];
}

export function describeTier(setting: TierSetting): string {
  return `${setting.provider}/${setting.model} · ${setting.effort}`;
}

export function readTierFile(dir = subagentsDir()): TierFile | undefined {
  return readJson<TierFile>(tiersFilePath(dir), isTierFile);
}

/** The configured rungs, or undefined while any is missing. */
export function readTiers(dir = subagentsDir()): TierConfig | undefined {
  const file = readTierFile(dir);
  if (!file) return undefined;
  return completeTiers(file.tiers);
}

/** Which rungs still need choosing. */
export function missingTiers(
  tiers: Partial<Record<Tier, TierSetting>> | undefined,
): Tier[] {
  return TIERS.filter((tier) => !tiers?.[tier]);
}

export function completeTiers(
  tiers: Partial<Record<Tier, TierSetting>> | undefined,
): TierConfig | undefined {
  if (missingTiers(tiers).length > 0) return undefined;
  return {
    base: tiers!.base!,
    mid: tiers!.mid!,
    strong: tiers!.strong!,
  };
}

export function writeTiers(tiers: TierConfig, dir = subagentsDir()): void {
  const payload: TierFile = { updatedAt: Date.now(), tiers };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tiersFilePath(dir), JSON.stringify(payload), "utf8");
  } catch {
    // Configuration is a UI affordance; never fail a tool call over it.
  }
}

export function writeModelCatalog(
  models: ModelOption[],
  dir = subagentsDir(),
): void {
  const payload: ModelCatalog = { updatedAt: Date.now(), models };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(modelsFilePath(dir), JSON.stringify(payload), "utf8");
  } catch {
    // Best-effort: the panel falls back to letting the user type ids.
  }
}

export function readModelCatalog(dir = subagentsDir()): ModelOption[] {
  const file = readJson<ModelCatalog>(modelsFilePath(dir), isModelCatalog);
  return file?.models ?? [];
}

function readJson<T>(
  path: string,
  check: (value: unknown) => value is T,
): T | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return check(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isTierFile(value: unknown): value is TierFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TierFile>;
  if (typeof candidate.updatedAt !== "number") return false;
  if (typeof candidate.tiers !== "object" || candidate.tiers === null) {
    return false;
  }
  return Object.entries(candidate.tiers).every(
    ([tier, setting]) => isTier(tier) && isTierSetting(setting),
  );
}

function isTierSetting(value: unknown): value is TierSetting {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TierSetting>;
  return (
    typeof candidate.provider === "string" &&
    candidate.provider.length > 0 &&
    typeof candidate.model === "string" &&
    candidate.model.length > 0 &&
    isEffort(candidate.effort)
  );
}

function isModelCatalog(value: unknown): value is ModelCatalog {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ModelCatalog>;
  if (typeof candidate.updatedAt !== "number") return false;
  if (!Array.isArray(candidate.models)) return false;
  return candidate.models.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const model = entry as Partial<ModelOption>;
    return typeof model.provider === "string" && typeof model.id === "string";
  });
}
