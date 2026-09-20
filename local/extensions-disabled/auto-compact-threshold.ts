import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Per-model auto-compaction at a fixed context-usage percentage.
 *
 * pi's built-in `reserveTokens` is a single absolute token count compared
 * against the *active* model's window, so one value cannot hit e.g. 70% across
 * models with wildly different windows (hy3 256k, muse-spark 1M, glm 200k...).
 *
 * This extension reads `ctx.getContextUsage().percent`, which pi already
 * normalizes to the *current* model's window, and triggers `ctx.compact()`
 * once usage reaches `TARGET`. Because the percentage is per-model, the 70%
 * trigger is correct for every model you switch to — no fixed reserveTokens,
 * no per-project config, no constant-compaction on small models.
 *
 * It hooks `turn_end` (fires after *every* turn, including inside a long
 * autonomous run), so it compacts at 70% *during* a task — before the context
 * can overflow into a state pi can't summarize. Override the threshold at
 * launch with PI_COMPACT_THRESHOLD (e.g. 0.8).
 */
const configuredTarget = Number(process.env.PI_COMPACT_THRESHOLD ?? 0.7);
const TARGET =
  Number.isFinite(configuredTarget) &&
  configuredTarget > 0 &&
  configuredTarget < 1
    ? configuredTarget
    : 0.7;
const COOLDOWN_MS = 10_000;
const MAX_FAILURES = 3;
const DISABLE_MS = 10 * 60_000;

let compacting = false;
let lastCompactAt = 0;
let failures = 0;
let disabledUntil = 0;

function reset(): void {
  compacting = false;
  lastCompactAt = 0;
  failures = 0;
  disabledUntil = 0;
}

function note(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "error",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function maybeCompact(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const now = Date.now();
  if (compacting || now < disabledUntil) return;

  const usage = ctx.getContextUsage();
  if (
    !usage ||
    usage.percent === null ||
    !Number.isFinite(usage.percent) ||
    usage.percent < 0
  ) {
    return;
  }

  // Pi reports `percent` as a percentage number (0-100+), not a fraction.
  const pct = usage.percent;

  // Past the window — the session is in an overflowed state that compaction
  // can't recover from (prepareCompaction returns "Nothing to compact"). Don't
  // hammer it with failing calls; tell the user to start fresh.
  if (pct > 100) {
    note(
      ctx,
      `Context at ${Math.round(pct)}% — over the window. Auto-compaction can't run here; start a new session or /compact manually.`,
      "error",
    );
    disabledUntil = now + DISABLE_MS;
    return;
  }

  if (pct < TARGET * 100) return;
  if (now - lastCompactAt < COOLDOWN_MS) return;

  compacting = true;
  lastCompactAt = now;
  note(
    ctx,
    `Context at ${Math.round(pct)}% of ${usage.contextWindow} — auto-compacting (target ${Math.round(TARGET * 100)}%)`,
    "info",
  );

  ctx.compact({
    onComplete: () => {
      compacting = false;
      failures = 0;

      // Extension-triggered compaction aborts the current agent run, unlike
      // pi's internal threshold path. Queue a continuation so long-running
      // autonomous work resumes immediately with the compacted context.
      pi.sendUserMessage(
        "Continue the current task from the compacted context.",
        {
          deliverAs: "followUp",
        },
      );
    },
    onError: (err: Error) => {
      compacting = false;
      failures += 1;
      lastCompactAt = now;
      if (failures >= MAX_FAILURES) disabledUntil = now + DISABLE_MS;
      note(ctx, `Auto-compaction failed: ${err.message}`, "error");
    },
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => reset());

  // Check after every completed model/tool turn so long-running autonomous
  // tasks compact before overflowing. onComplete queues the continuation that
  // ctx.compact() itself does not provide for extension-triggered compaction.
  pi.on("turn_end", (_event, ctx) => maybeCompact(pi, ctx));

  // Release the guard on a successful compaction.
  pi.on("session_compact", (_event, _ctx) => {
    compacting = false;
    failures = 0;
  });

  pi.registerCommand("auto-compact-status", {
    description: "Show the auto-compaction target and current context usage",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const raw = usage?.percent;
      const pct =
        raw !== null && raw !== undefined && Number.isFinite(raw)
          ? `${Math.round(raw)}%`
          : "unknown";
      const win = usage?.contextWindow ?? "?";
      note(
        ctx,
        `Auto-compact target ${Math.round(TARGET * 100)}% — current ${pct} (window ${win})`,
        "info",
      );
    },
  });
}
