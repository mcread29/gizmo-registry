import { describe, expect, it } from "vitest";
import { PatchMismatchError, parseHunks, revertPatch } from "./patch";

const original = [
  "using UnityEngine;",
  "",
  "public class Player {",
  "\tint speed = 1;",
  "}",
  "",
].join("\n");
const edited = [
  "using UnityEngine;",
  "",
  "public class Player {",
  "\tint speed = 2;",
  "\tint jump = 3;",
  "}",
  "",
].join("\n");
const patch = [
  "--- a/Player.cs",
  "+++ b/Player.cs",
  "@@ -3,3 +3,4 @@",
  " public class Player {",
  "-\tint speed = 1;",
  "+\tint speed = 2;",
  "+\tint jump = 3;",
  " }",
].join("\n");

describe("revertPatch", () => {
  it("restores the file the agent edited", () => {
    expect(revertPatch(edited, patch)).toBe(original);
  });

  it("refuses when the file no longer matches the recorded change", () => {
    const moved = edited.replace("int speed = 2;", "int speed = 9;");

    expect(() => revertPatch(moved, patch)).toThrow(PatchMismatchError);
  });

  it("reads hunk positions from the header", () => {
    expect(parseHunks(patch)).toHaveLength(1);
    expect(parseHunks(patch)[0]).toMatchObject({ oldStart: 3, newStart: 3 });
  });

  it("rejects a patch with nothing to apply", () => {
    expect(() => revertPatch(edited, "not a patch")).toThrow(
      PatchMismatchError,
    );
  });
});
