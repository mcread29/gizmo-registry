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

it("gives a folder the directory it stands for and the verbs that take one", () => {
  const nodes = changeTree(
    [{ path: "src/deep/a.ts", index: " ", workingTree: "M" }],
    "unstaged",
    ["stage", "revert"],
  );

  expect(nodes[0]).toMatchObject({
    label: "src",
    path: "src",
    actions: ["stage", "revert"],
  });
  const leaf = nodes[0].children?.[0].children?.[0];
  expect(leaf).toMatchObject({ path: "src/deep/a.ts" });
  // A file carries every verb, so it names none of them.
  expect(leaf?.actions).toBeUndefined();
  expect(
    parseView({
      title: "Changes",
      blocks: [{ type: "tree", id: "changes", nodes }],
    }),
  ).toBeDefined();
});
