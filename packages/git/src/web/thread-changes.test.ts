import type { ConversationMessage } from "@gizmo/protocol";
import { describe, expect, it } from "vitest";
import { changeTotals, patchFileName, threadChanges } from "./thread-changes";

const patch = [
  "--- a/Assets/Player.cs",
  "+++ b/Assets/Player.cs",
  "@@ -1,2 +1,3 @@",
  " class Player {",
  "-  int speed = 1;",
  "+  int speed = 2;",
  "+  int jump = 3;",
].join("\n");

function message(tools: ConversationMessage["tools"]): ConversationMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    createdAt: 0,
    complete: true,
    tools,
  };
}

describe("threadChanges", () => {
  it("groups every write by file with cumulative counts", () => {
    const files = threadChanges([
      message([
        {
          id: "t1",
          name: "edit",
          status: "complete",
          statusText: "Completed",
          result: { patch },
        },
        {
          id: "t2",
          name: "read",
          status: "complete",
          statusText: "Completed",
          result: { text: "x" },
        },
        {
          id: "t3",
          name: "write",
          status: "complete",
          statusText: "Completed",
          result: { file: "Assets/Player.cs", patch },
        },
      ]),
    ]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      file: "Assets/Player.cs",
      added: 4,
      removed: 2,
    });
    expect(files[0]?.changes).toHaveLength(2);
    expect(changeTotals(files)).toEqual({ added: 4, removed: 2 });
  });

  it("recovers the path from the patch header when the result omits it", () => {
    expect(patchFileName(patch)).toBe("Assets/Player.cs");
    expect(patchFileName("+++ /dev/null")).toBeUndefined();
  });

  it("ignores tools that produced no patch", () => {
    expect(
      threadChanges([
        message([
          { id: "t1", name: "edit", status: "running", statusText: "Editing" },
        ]),
      ]),
    ).toEqual([]);
  });
});
