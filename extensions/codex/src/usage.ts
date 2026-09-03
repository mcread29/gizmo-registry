/**
 * Shared Codex usage types, parsing, and formatting.
 *
 * Pure on purpose: the server (agent-server process, Node fetch) and the web
 * bundle (browser) both import it, so it must never touch node builtins.
 */

/** One rate-limit window, as reported by Codex's usage endpoint. */
export interface CodexUsageWindow {
  /** Percent of the window consumed (0-100). */
  usedPercent: number;
  /** Window length in seconds (e.g. 18000 = 5 hours, 604800 = a week). */
  windowSeconds: number;
  /** Seconds from the response until the window resets. */
  resetAfterSeconds: number;
}

/** A named extra limit on top of the plan's primary/secondary windows. */
export interface CodexUsageLimit {
  name: string;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
}

/** The parsed, trimmed shape the web UI receives from the `usage` operation. */
export interface CodexUsageSnapshot {
  fetchedAt: number;
  planType: string | null;
  email: string | null;
  limitReached: boolean;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  additional: CodexUsageLimit[];
  credits: { hasCredits: boolean; unlimited: boolean; balance: string } | null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function parseWindow(raw: unknown): CodexUsageWindow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const window = raw as Record<string, unknown>;
  const usedPercent = numberOf(window.used_percent);
  const windowSeconds = numberOf(window.limit_window_seconds);
  const resetAfterSeconds = numberOf(window.reset_after_seconds);
  if (
    usedPercent === null ||
    windowSeconds === null ||
    resetAfterSeconds === null
  ) {
    return null;
  }
  return { usedPercent, windowSeconds, resetAfterSeconds };
}

function parseRateLimit(raw: unknown): {
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  limitReached: boolean;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rateLimit = raw as Record<string, unknown>;
  const primary = parseWindow(rateLimit.primary_window);
  const secondary = parseWindow(rateLimit.secondary_window);
  const limitReached = rateLimit.limit_reached === true;
  if (!primary && !secondary && !limitReached) return null;
  return { primary, secondary, limitReached };
}

/**
 * Leniently parse ChatGPT's `/backend-api/wham/usage` payload. Returns null
 * when the payload is not recognizable usage data at all.
 */
export function parseUsageSnapshot(
  raw: unknown,
  fetchedAt: number = Date.now(),
): CodexUsageSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const payload = raw as Record<string, unknown>;
  const rateLimit = parseRateLimit(payload.rate_limit);
  if (!rateLimit) return null;

  const additional: CodexUsageLimit[] = Array.isArray(
    payload.additional_rate_limits,
  )
    ? payload.additional_rate_limits.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const record = entry as Record<string, unknown>;
        const name = stringOf(record.limit_name);
        const parsed = parseRateLimit(record.rate_limit);
        if (!name || !parsed) return [];
        return [
          {
            name,
            primary: parsed.primary,
            secondary: parsed.secondary,
          },
        ];
      })
    : [];

  let credits: CodexUsageSnapshot["credits"] = null;
  if (typeof payload.credits === "object" && payload.credits !== null) {
    const creditsRecord = payload.credits as Record<string, unknown>;
    credits = {
      hasCredits: creditsRecord.has_credits === true,
      unlimited: creditsRecord.unlimited === true,
      balance: stringOf(creditsRecord.balance) ?? "0",
    };
  }

  return {
    fetchedAt,
    planType: stringOf(payload.plan_type),
    email: stringOf(payload.email),
    limitReached: payload.limit_reached === true || rateLimit.limitReached,
    primary: rateLimit.primary,
    secondary: rateLimit.secondary,
    additional,
    credits,
  };
}

/** Human name for a window length: known Codex windows get their usual names. */
export function windowLabel(windowSeconds: number): string {
  if (windowSeconds === 604800) return "Weekly";
  if (windowSeconds === 86400) return "Daily";
  if (windowSeconds === 18000) return "5-hour";
  const hours = windowSeconds / 3600;
  if (Number.isInteger(hours) && hours < 48) return `${hours}-hour`;
  const days = windowSeconds / 86400;
  if (Number.isInteger(days)) return `${days}-day`;
  return formatDuration(windowSeconds);
}

/** Compact duration text: "2d 4h", "3h 10m", "45m". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Titlebar/indicator tone for how much of a window has been consumed. */
export function usageTone(
  usedPercent: number,
): "default" | "accent" | "danger" {
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 75) return "accent";
  return "default";
}
