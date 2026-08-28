import { protocolVersion } from "@gizmo/protocol";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../app-settings";
import type { AgentStore } from "../../agent-client";
import { WorkspaceLayout } from "../shell/workspace.svelte";
import CompileConfirmationDialog from "./CompileConfirmationDialog.svelte";

describe("CompileConfirmationDialog", () => {
  it("remembers the choice to keep Play Mode running", async () => {
    const confirmation = {
      protocolVersion,
      eventId: 1,
      sessionId: "session-1",
      type: "confirmation.requested" as const,
      confirmationId: "confirmation-1",
      kind: "stop_play_mode_for_compile" as const,
      projectPath: "/projects/game",
    };
    const resolveConfirmation = vi.fn(async () => {});
    const store = {
      pendingConfirmations: [confirmation],
      resolveConfirmation,
    } as unknown as AgentStore;
    const layout = new WorkspaceLayout({ ...defaultAppSettings });
    const { findByRole } = render(CompileConfirmationDialog, { store, layout });

    await fireEvent.click(await findByRole("button", { name: "Keep playing" }));

    expect(layout.compilePlayModePolicy).toBe("keep_playing");
    expect(resolveConfirmation).toHaveBeenCalledWith(confirmation, false);
  });

  it("applies a remembered stop policy without prompting again", async () => {
    const confirmation = {
      protocolVersion,
      eventId: 1,
      sessionId: "session-1",
      type: "confirmation.requested" as const,
      confirmationId: "confirmation-1",
      kind: "stop_play_mode_for_compile" as const,
      projectPath: "/projects/game",
    };
    const resolveConfirmation = vi.fn(async () => {});
    const store = {
      pendingConfirmations: [confirmation],
      resolveConfirmation,
    } as unknown as AgentStore;
    const layout = new WorkspaceLayout({
      ...defaultAppSettings,
      compilePlayModePolicy: "stop",
    });
    const { queryByRole } = render(CompileConfirmationDialog, {
      store,
      layout,
    });

    await vi.waitFor(() =>
      expect(resolveConfirmation).toHaveBeenCalledWith(confirmation, true),
    );
    expect(
      queryByRole("dialog", { name: "Stop Play Mode to compile?" }),
    ).not.toBeInTheDocument();
  });
});
