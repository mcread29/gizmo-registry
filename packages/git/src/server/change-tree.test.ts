import { expect, it } from "vitest";
import { parseView } from "@gizmo/extension-api";
import { changeTree } from "./change-tree";

it("keeps file identity when polling adds or removes earlier files", () => {
  const file = (path: string) => ({ path, index: " ", workingTree: "M" });
  const original = changeTree([file("b with spaces.txt")], "unstaged");
  const updated = changeTree(
    [file("a.txt"), file("b with spaces.txt")],
    "unstaged",
  );
  expect(original[0].id).toBe(updated[1].id);
  expect(original[0].id).not.toBe(updated[0].id);
  expect(
    parseView({
      title: "Changes",
      blocks: [{ type: "tree", id: "changes", nodes: updated }],
    }),
  ).toBeDefined();
});
