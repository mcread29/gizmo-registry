import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isInsideDirectory } from "./core";

describe("isInsideDirectory", () => {
  const dir = resolve("stage-1");

  it("accepts files inside the directory on the host separator", () => {
    expect(isInsideDirectory(dir, join(dir, "manual-page.html"))).toBe(true);
    expect(isInsideDirectory(dir, join(dir, "nested", "page.html"))).toBe(true);
  });

  it("rejects the directory itself, siblings, and traversal", () => {
    expect(isInsideDirectory(dir, dir)).toBe(false);
    expect(isInsideDirectory(dir, join(dir, "..", "stage-2", "x.html"))).toBe(
      false,
    );
    expect(isInsideDirectory(dir, resolve("stage-10", "x.html"))).toBe(false);
    expect(isInsideDirectory(dir, resolve("elsewhere.html"))).toBe(false);
  });
});
