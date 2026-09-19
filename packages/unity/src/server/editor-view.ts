/**
 * The Unity Editor view: what the Editor is doing and what the last status
 * check reported, with its compiler diagnostics as a list whose items carry
 * file paths the host can open. This replaces the old Editor/Unity panels.
 */

import type {
  ActionEvent,
  ActionResult,
  Block,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import {
  compilerDiagnostics,
  diagnosticPath,
  type CompilerDiagnostic,
} from "./compiler-diagnostics";
import { UnityProjectService } from "./domain/unity-project-service";
import { parseUnityStatus, type UnityStatus } from "./unity-wire";

const diagnosticsBlockId = "diagnostics";

export interface EditorState {
  status?: UnityStatus;
  error?: string;
  loading: boolean;
}

export function statusLabel(state: UnityStatus["state"] | undefined): string {
  switch (state) {
    case "connected":
      return "Ready";
    case "disconnected":
      return "Disconnected";
    case "unavailable":
      return "CLI unavailable";
    case "error":
      return "Check failed";
    default:
      return "Not checked";
  }
}

function editorValue(
  instance: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!instance) return undefined;
  for (const key of keys) {
    const value = instance[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

export function statusDiagnostics(
  status: UnityStatus | undefined,
): CompilerDiagnostic[] {
  return [
    ...compilerDiagnostics(status?.errors ?? []),
    ...compilerDiagnostics(status?.warnings ?? []),
  ];
}

export function renderEditorView(
  state: EditorState,
  workspacePath: string,
): View {
  const status = state.status;
  const editor = status?.instances[0];
  const diagnostics = statusDiagnostics(status);
  const errors = status?.errors.length ?? 0;
  const blocks: Block[] = [
    {
      type: "keyValue",
      entries: [
        {
          label: "Editor",
          value: editorValue(editor, ["state", "connectionState"]) ??
            statusLabel(status?.state),
          tone: status?.state === "connected" ? "success" : "warning",
        },
        {
          label: "Project",
          value:
            editorValue(editor, ["projectPath", "project"]) ?? workspacePath,
        },
        {
          label: "Unity version",
          value: editorValue(editor, ["version", "unityVersion"]) ?? "unknown",
        },
        {
          label: "Instances",
          value: String(status?.instances.length ?? 0),
        },
      ],
    },
  ];

  if (state.error) blocks.push({ type: "text", text: state.error, tone: "error" });

  blocks.push({
    type: "list",
    id: diagnosticsBlockId,
    empty: "No compiler diagnostics reported.",
    items: diagnostics.map((diagnostic, index) => {
      const path = diagnosticPath(diagnostic, workspacePath);
      return {
        id: `d${index}`,
        label: diagnostic.message,
        detail: [diagnostic.code, diagnostic.file, diagnostic.line]
          .filter((part) => part !== undefined && part !== "")
          .join(" · "),
        ...(path ? { path } : {}),
        tone: diagnostic.severity === "warning" ? ("warning" as const) : ("error" as const),
      };
    }),
  });

  if (status?.stderr?.trim()) {
    blocks.push({
      type: "section",
      title: "Unity CLI output",
      collapsed: true,
      blocks: [{ type: "code", code: status.stderr }],
    });
  }

  return {
    title: "Unity",
    status: state.error || errors ? "error" : state.loading ? "running" : "idle",
    ...(errors ? { badge: errors, badgeTone: "danger" as const } : {}),
    blocks,
    actions: [
      { id: "refresh", label: "Refresh" },
      { id: "open-editor", label: "Open Unity Editor", tone: "primary" },
      {
        id: "open-file",
        label: "Open file",
        selection: { blockId: diagnosticsBlockId, required: true },
        intent: {
          kind: "openFile",
          target: { kind: "selection", blockId: diagnosticsBlockId },
        },
      },
    ],
  };
}

export function openEditorView(context: ViewContext): ViewHandle {
  const service = new UnityProjectService();
  const state: EditorState = { loading: true };
  let disposed = false;

  const push = () => {
    if (!disposed) context.update(renderEditorView(state, context.workspacePath));
  };

  async function refresh(): Promise<void> {
    try {
      state.status = parseUnityStatus(
        await service.getStatus(context.workspacePath),
      );
      state.error = undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      push();
    }
  }

  push();
  void (async () => {
    try {
      // The service polls the Editor itself and only reports changes.
      state.status = parseUnityStatus(
        await service.watchStatus(context.workspacePath, {
          status: (next) => {
            try {
              state.status = parseUnityStatus(next);
              state.error = undefined;
            } catch (error) {
              state.error =
                error instanceof Error ? error.message : String(error);
            }
            push();
          },
        }),
      );
      state.error = undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      push();
    }
  })();

  async function action(event: ActionEvent): Promise<ActionResult> {
    if (event.cancelled) return { status: "rejected" };
    try {
      switch (event.actionId) {
        case "refresh":
          await refresh();
          return { status: "succeeded" };
        case "open-editor": {
          await service.openProject(context.workspacePath);
          await refresh();
          return { status: "succeeded", message: "Unity Editor opening" };
        }
        default:
          return { status: "failed", message: "Unknown action" };
      }
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    action,
    dispose() {
      disposed = true;
      service.dispose();
    },
  };
}
