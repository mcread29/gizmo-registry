import { describe, expect, it } from "vitest";
import {
  formatDuration,
  parseUsageSnapshot,
  usageTone,
  windowLabel,
} from "./usage.ts";

const SAMPLE = {
  user_id: "user-x",
  account_id: "acc-x",
  email: "user@example.com",
  plan_type: "prolite",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 50,
      limit_window_seconds: 604800,
      reset_after_seconds: 375741,
      reset_at: 1788755618,
    },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: "GPT-5.3-Codex-Spark",
      metered_feature: "codex_bengalfox",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 18000,
          reset_after_seconds: 18000,
          reset_at: 1788397877,
        },
        secondary_window: {
          used_percent: 12.5,
          limit_window_seconds: 604800,
          reset_after_seconds: 604800,
          reset_at: 1788984677,
        },
      },
    },
  ],
  model_usage: {},
  credits: {
    has_credits: false,
    unlimited: false,
    overage_limit_reached: false,
    balance: "0",
    approx_local_messages: [0, 0],
    approx_cloud_messages: [0, 0],
  },
  rate_limit_reached_type: null,
};

describe("parseUsageSnapshot", () => {
  it("parses a real wham/usage payload", () => {
    const snapshot = parseUsageSnapshot(SAMPLE, 1_000);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.fetchedAt).toBe(1_000);
    expect(snapshot!.planType).toBe("prolite");
    expect(snapshot!.email).toBe("user@example.com");
    expect(snapshot!.limitReached).toBe(false);
    expect(snapshot!.primary).toEqual({
      usedPercent: 50,
      windowSeconds: 604800,
      resetAfterSeconds: 375741,
    });
    expect(snapshot!.secondary).toBeNull();
    expect(snapshot!.additional).toHaveLength(1);
    expect(snapshot!.additional[0].name).toBe("GPT-5.3-Codex-Spark");
    expect(snapshot!.additional[0].primary?.windowSeconds).toBe(18000);
    expect(snapshot!.additional[0].secondary?.usedPercent).toBe(12.5);
    expect(snapshot!.credits).toEqual({
      hasCredits: false,
      unlimited: false,
      balance: "0",
    });
  });

  it("flags limit_reached from the top level or the rate limit", () => {
    const top = parseUsageSnapshot({
      ...SAMPLE,
      limit_reached: true,
    });
    expect(top!.limitReached).toBe(true);
    const nested = parseUsageSnapshot({
      rate_limit: {
        limit_reached: true,
        primary_window: {
          used_percent: 100,
          limit_window_seconds: 18000,
          reset_after_seconds: 0,
        },
      },
    });
    expect(nested!.limitReached).toBe(true);
  });

  it("returns null for non-usage payloads", () => {
    expect(parseUsageSnapshot(null)).toBeNull();
    expect(parseUsageSnapshot("nope")).toBeNull();
    expect(parseUsageSnapshot({})).toBeNull();
    expect(parseUsageSnapshot({ rate_limit: null })).toBeNull();
  });

  it("drops malformed additional limits and tolerates missing credits", () => {
    const snapshot = parseUsageSnapshot({
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 18000,
          reset_after_seconds: 100,
        },
      },
      additional_rate_limits: [null, { limit_name: "x" }, "junk"],
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.additional).toEqual([]);
    expect(snapshot!.credits).toBeNull();
  });
});

describe("windowLabel", () => {
  it("names Codex's known windows", () => {
    expect(windowLabel(18000)).toBe("5-hour");
    expect(windowLabel(86400)).toBe("Daily");
    expect(windowLabel(604800)).toBe("Weekly");
  });

  it("formats other window lengths generically", () => {
    expect(windowLabel(3600)).toBe("1-hour");
    expect(windowLabel(172800)).toBe("2-day");
  });
});

describe("formatDuration", () => {
  it("renders compact reset times", () => {
    expect(formatDuration(375_741)).toBe("4d 8h");
    expect(formatDuration(11_400)).toBe("3h 10m");
    expect(formatDuration(2_700)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("usageTone", () => {
  it("escalates with consumption", () => {
    expect(usageTone(10)).toBe("default");
    expect(usageTone(75)).toBe("accent");
    expect(usageTone(89.9)).toBe("accent");
    expect(usageTone(90)).toBe("danger");
  });
});
