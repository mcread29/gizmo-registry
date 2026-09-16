import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { GitHostStore } from "./host";
import ChangesPanel from "./ChangesPanel.svelte";

describe("ChangesPanel", () => {
  it("shows a partially staged file in both sections and stages it", async () => {
    const stageFile = vi.fn(async () => {});
    const store = {
      messages: [],
      gitStatus: {
        rootPath: "/projects/game",
        branch: "main",
        clean: false,
        files: [{ path: "Player.cs", index: "M", workingTree: "M" }],
      },
      gitLoading: false,
      gitCommitting: false,
      refreshGitStatus: vi.fn(async () => {}),
      generateCommitMessage: vi.fn(async () => "Update player movement"),
      commitAll: vi.fn(async () => ({
        rootPath: "/projects/game",
        commit: "0123456789abcdef",
        message: "Update player movement",
      })),
      revertFile: vi.fn(async () => {}),
      invokeProjectExtension: vi.fn(async () => ({})),
    } satisfies GitHostStore;

    const { getAllByText, getByRole, queryByText, unmount } = render(
      ChangesPanel,
      {
        store,
        projectPath: "/projects/game",
        stageFile,
        unstageFile: vi.fn(async () => {}),
      },
    );

    expect(
      getByRole("button", { name: /Unstaged Changes \(1\)/ }),
    ).toBeInTheDocument();
    expect(
      getByRole("button", { name: /Staged Changes \(1\)/ }),
    ).toBeInTheDocument();
    expect(getAllByText("Player.cs")).toHaveLength(2);

    await fireEvent.click(getByRole("button", { name: "Stage file" }));
    expect(stageFile).toHaveBeenCalledWith("Player.cs");

    await fireEvent.click(
      getByRole("button", { name: /Unstaged Changes \(1\)/ }),
    );
    expect(getAllByText("Player.cs")).toHaveLength(1);
    await fireEvent.click(
      getByRole("button", { name: /Staged Changes \(1\)/ }),
    );
    expect(queryByText("Player.cs")).not.toBeInTheDocument();
    unmount();
  });

  it("collapses and reopens a folder inside a group", async () => {
    const store = {
      messages: [],
      gitStatus: {
        rootPath: "/projects/game",
        branch: "main",
        clean: false,
        files: [
          { path: "Assets/Scripts/Player.cs", index: " ", workingTree: "M" },
          { path: "README.md", index: " ", workingTree: "M" },
        ],
      },
      gitLoading: false,
      gitCommitting: false,
      refreshGitStatus: vi.fn(async () => {}),
      generateCommitMessage: vi.fn(async () => "Update player movement"),
      commitAll: vi.fn(async () => ({
        rootPath: "/projects/game",
        commit: "0123456789abcdef",
        message: "Update player movement",
      })),
      revertFile: vi.fn(async () => {}),
      invokeProjectExtension: vi.fn(async () => ({})),
    } satisfies GitHostStore;

    const { getByText, queryByText, unmount } = render(ChangesPanel, {
      store,
      projectPath: "/projects/game",
      stageFile: vi.fn(async () => {}),
      unstageFile: vi.fn(async () => {}),
    });

    await fireEvent.click(getByText("Assets"));
    expect(queryByText("Scripts")).not.toBeInTheDocument();
    expect(queryByText("Player.cs")).not.toBeInTheDocument();
    // Sibling rows outside the folder stay put.
    expect(getByText("README.md")).toBeInTheDocument();

    await fireEvent.click(getByText("Assets"));
    expect(getByText("Scripts")).toBeInTheDocument();
    expect(getByText("Player.cs")).toBeInTheDocument();
    unmount();
  });

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
      invokeProjectExtension: vi.fn(async () => ({})),
    } satisfies GitHostStore;
    const { findByRole, getByRole, getByText, getByTitle, unmount } = render(
      ChangesPanel,
      {
        store,
        projectPath: "/projects/game",
        stageFile: vi.fn(async () => {}),
        unstageFile: vi.fn(async () => {}),
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
    unmount();
  });

  it("opens the commit dialog with an empty message when generation fails", async () => {
    const generateCommitMessage = vi.fn(async () => {
      throw new Error("Upstream request failed");
    });
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
      invokeProjectExtension: vi.fn(async () => ({})),
    } satisfies GitHostStore;
    const { findByRole, getByRole, unmount } = render(ChangesPanel, {
      store,
      projectPath: "/projects/game",
      stageFile: vi.fn(async () => {}),
      unstageFile: vi.fn(async () => {}),
    });

    await fireEvent.click(getByRole("button", { name: "Commit all" }));

    const message = await findByRole("textbox", { name: "Commit message" });
    expect(message).toHaveValue("");
    expect(generateCommitMessage).toHaveBeenCalledTimes(1);

    await fireEvent.input(message, {
      target: { value: "Manual commit message" },
    });
    const dialog = await findByRole("dialog", { name: "Commit all changes" });
    await fireEvent.click(
      dialog.querySelector('button:not([data-variant="ghost"])')!,
    );
    expect(commitAll).toHaveBeenCalledWith("Manual commit message");
    unmount();
  });
});
