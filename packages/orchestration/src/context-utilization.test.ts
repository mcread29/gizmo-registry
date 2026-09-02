import { expect, test } from "vitest";
import {
  contextPercent,
  formatContextUtilization,
} from "./context-utilization.ts";

test("formats current context occupancy against model capacity", () => {
  expect(
    formatContextUtilization({ tokens: 26_040, contextWindow: 372_000 }),
  ).toBe("7%/372k");
});

test("formats the latest post-compaction usage rather than prior cumulative usage", () => {
  const latestUsage = { tokens: 18_000, contextWindow: 200_000 };
  expect(formatContextUtilization(latestUsage)).toBe("9%/200k");
});

test("clamps over-capacity and nonsensical token values", () => {
  expect(contextPercent({ tokens: 500_000, contextWindow: 200_000 })).toBe(100);
  expect(
    formatContextUtilization({
      tokens: Number.POSITIVE_INFINITY,
      contextWindow: 200_000,
    }),
  ).toBe("?%/200k");
  expect(formatContextUtilization({ tokens: -1, contextWindow: 200_000 })).toBe(
    "?%/200k",
  );
});

test("handles missing usage or capacity without NaN or Infinity", () => {
  expect(
    formatContextUtilization({ tokens: null, contextWindow: 372_000 }),
  ).toBe("?%/372k");
  expect(formatContextUtilization({ tokens: 12_000 })).toBe("");
  expect(formatContextUtilization({ tokens: 12_000, contextWindow: 0 })).toBe(
    "",
  );
});
