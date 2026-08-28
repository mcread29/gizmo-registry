import type { ToolCallView } from "@gizmo/protocol";
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ActivityPanel from "./ActivityPanel.svelte";

describe("ActivityPanel", () => {
  it("only mounts the visible window from a long activity history", () => {
    const toolActivity: ToolCallView[] = Array.from(
      { length: 500 },
      (_, index) => ({
        id: `tool-${index}`,
        name: "read",
        status: "complete",
        statusText: "Completed",
        input: `Assets/File-${index}.cs`,
      }),
    );
    const view = { toolActivity };

    const { container, getByText } = render(ActivityPanel, { view });

    expect(
      container.querySelectorAll('[data-ui="activity-item"]'),
    ).toHaveLength(21);
    expect(getByText("Assets/File-0.cs")).toBeInTheDocument();
  });
});
