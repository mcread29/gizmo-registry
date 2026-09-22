/**
 * Tier ladder resolution and the interactive `/subagents tiers` setup flow.
 */

import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activeModel, type ThinkingLevel, type TierRung } from "./manager.ts";
import {
  EFFORTS,
  TIERS,
  describeTier,
  ladderFrom,
  missingTiers,
  readTierFile,
  tierLabel,
  writeTiers,
  type Tier,
  type TierConfig,
  type TierSetting,
} from "./tiers.ts";

/**
 * Resolves the configured tiers into the ladder a spawn will run, starting at
 * `tier` and climbing from there. Throws with the reason spawning is blocked,
 * since an unconfigured or stale configuration is a setup problem, not
 * something a subagent should paper over.
 */
export function resolveLadder(
  ctx: ExtensionContext,
  tiers: TierConfig,
  tier: Tier,
  effortOverride: string | undefined,
): TierRung[] {
  return ladderFrom(tier).map((name, index) => {
    const setting = tiers[name];
    const model = ctx.modelRegistry.find(setting.provider, setting.model);
    if (!model) {
      throw new Error(
        `The ${tierLabel(name)} tier is set to ${setting.provider}/${setting.model}, which this session's model registry does not offer. Re-run /subagents tiers to pick an available model.`,
      );
    }
    const effort =
      index === 0 && effortOverride ? effortOverride : setting.effort;
    return { tier: name, model, thinkingLevel: effort as ThinkingLevel };
  });
}

export function tiersGuidance(): string {
  const missing = missingTiers(readTierFile()?.tiers);
  return missing.length === 0
    ? "Subagent tiers are incomplete. Re-run /subagents tiers."
    : `Subagents are disabled until all three model tiers are configured (missing: ${missing
        .map(tierLabel)
        .join(
          ", ",
        )}). Choose a model and effort for the base, mid, and strong tiers in Gizmo's Settings → Extensions → Subagents, or run /subagents tiers. The Subagents tab reports the ladder but cannot set it: the agent-server process does not own the subagents.`;
}

export function describeModel(model: ReturnType<typeof activeModel>): string {
  return model ? `${model.provider}/${model.id}` : "unknown model";
}

const TIER_HINTS: Record<Tier, string> = {
  base: "the default: everyday breadth work",
  mid: "climbed to when base fails",
  strong: "the expensive rung, reached only when the others fail",
};

/**
 * Interactive tier setup: a model and an effort for each of the three rungs.
 * Spawning stays disabled until all three exist, so delegation always costs
 * what someone decided it should.
 */
export async function configureTiers(
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    throw new Error(
      "Tier setup needs an interactive session (TUI or a UI host); it asks for a model and an effort per rung.",
    );
  }
  const models = ctx.modelRegistry.getAll();
  if (models.length === 0) {
    throw new Error("No models are available to this session.");
  }
  const options = models.map((model) => `${model.provider}/${model.id}`);
  const tiers: Partial<Record<Tier, TierSetting>> = {
    ...(readTierFile()?.tiers ?? {}),
  };
  for (const tier of TIERS) {
    const picked = await ctx.ui.select(
      `${tierLabel(tier)} tier — model (${TIER_HINTS[tier]})`,
      options,
    );
    if (!picked) {
      ctx.ui.notify("Tier setup cancelled; tiers are unchanged.", "info");
      return;
    }
    const separator = picked.indexOf("/");
    const provider = picked.slice(0, separator);
    const model = picked.slice(separator + 1);
    const effort = await ctx.ui.select(
      `${tierLabel(tier)} tier — thinking effort for ${picked}`,
      [...EFFORTS],
    );
    if (!effort) {
      ctx.ui.notify("Tier setup cancelled; tiers are unchanged.", "info");
      return;
    }
    tiers[tier] = { provider, model, effort: effort as TierSetting["effort"] };
  }
  writeTiers(tiers as TierConfig);
  ctx.ui.notify(
    `Subagent tiers saved (${TIERS.map((tier) => describeTier(tiers[tier]!)).join(", ")}). Spawning is enabled.`,
    "info",
  );
}
