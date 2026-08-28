import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { GitHostStore } from "./host";
import ChangesPanel from "./ChangesPanel.svelte";

describe("ChangesPanel", () => {
  it("lets the user review Pi’s message before committing everything", async () => {
    const generateCommitMessage = vi.fn(async () => "Update player movement");
    const commitAll = vi.fn(async (message: string) => ({
      rootPath: "/projects/game",
      commit: "0123456789abcdef",
      message,
    }));
    const store = {
      messages: [],
      gitStatus: {
        rootPath: "/projects/game",
        branch: "main",
        clean: false,
        files: [{ path: "Player.cs", index: " ", workingTree: "M" }],
      },
      gitLoading: false,
      gitCommitting: false,
      refreshGitStatus: vi.fn(async () => {}),
      generateCommitMessage,
      commitAll,
      revertFile: vi.fn(async () => {}),
    } satisfies GitHostStore;
    const { findByRole, getByRole, getByText, getByTitle } = render(
      ChangesPanel,
      {
        store,
        projectPath: "/projects/game",
      },
    );
    expect(getByText("Player.cs")).toBeInTheDocument();
    expect(getByTitle("Modified")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Commit all" }));

    const message = await findByRole("textbox", { name: "Commit message" });
    expect(message).toHaveValue("Update player movement");
    expect(commitAll).not.toHaveBeenCalled();

    await fireEvent.input(message, {
      target: { value: "Polish player movement" },
    });
    const dialog = await findByRole("dialog", { name: "Commit all changes" });
    await fireEvent.click(
      dialog.querySelector('button:not([data-variant="ghost"])')!,
    );

    expect(commitAll).toHaveBeenCalledWith("Polish player movement");
  });
});
