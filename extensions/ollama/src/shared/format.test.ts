import { describe, expect, it } from "vitest";
import { formatBytes, formatContext, formatPercent } from "./format.ts";

describe("format", () => {
  it("formats bytes and context windows", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatContext(40_960)).toBe("40k ctx");
    expect(formatContext(undefined)).toBe("");
    expect(formatPercent(41.4)).toBe("41%");
    expect(formatPercent(undefined)).toBe("");
  });
});
