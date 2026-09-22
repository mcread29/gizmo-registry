import {
  defineExtension,
  type ExtensionContext,
  type ExtensionDescriptor,
  type SettingsField,
  type StatusItem,
  type UiContext,
} from "@gizmo/extension-api";
import { openChangesView } from "./changes-view";
import { commitMessageModelKey } from "./commit-message";
import { GitService } from "./git-service";

const apiVersion = 1;

const service = new GitService();

const settings: SettingsField[] = [
  {
    kind: "model",
    key: commitMessageModelKey,
    label: "Commit message model",
    description:
      "Drafts commit messages in the Changes panel. Leave unset to use the host's default model.",
    thinking: true,
  },
];

function descriptor(): ExtensionDescriptor {
  return {
    id: "git",
    name: "Git",
    version: "0.0.0",
    apiVersion,
    capabilities: ["status", "stage", "commit", "push"],
    operations: [
      { id: "commit-context", mutates: false, requiresConfirmation: false },
      { id: "status", mutates: false, requiresConfirmation: false },
      { id: "stage", mutates: true, requiresConfirmation: false },
      { id: "unstage", mutates: true, requiresConfirmation: false },
      { id: "commit", mutates: true, requiresConfirmation: false },
      { id: "push-state", mutates: false, requiresConfirmation: false },
      {
        id: "push",
        mutates: true,
        // Pushing publishes work to a shared remote; the caller must say so.
        requiresConfirmation: true,
      },
    ],
  };
}

/** Git's single entry point into Gizmo's extension contract. */
export const gizmoExtension = defineExtension({
  id: "git",
  name: "Git",
  settings,
  createTools: (context: ExtensionContext) => [
    service.createStatusTool(context.workspacePath),
  ],
  list: async (workspacePath, signal) =>
    (await isInRepository(workspacePath, signal)) ? [descriptor()] : [],
  invoke: async (workspacePath, _extensionId, operationId, input, signal) => {
    switch (operationId) {
      case "status":
        return service.status(workspacePath, signal);
      case "commit-context":
        return service.commitContext(workspacePath);
      case "stage":
        return service.stageFile(workspacePath, filePath(input));
      case "unstage":
        return service.unstageFile(workspacePath, filePath(input));
      case "commit": {
        const message =
          typeof (input as { message?: unknown } | null)?.message === "string"
            ? (input as { message: string }).message
            : "";
        return service.commitAll(workspacePath, message);
      }
      case "push-state":
        return service.pushState(workspacePath, signal);
      case "push":
        return service.push(workspacePath, {
          setUpstream:
            (input as { setUpstream?: unknown } | null)?.setUpstream === true,
        });
      default:
        throw new Error(`Unknown Git operation: ${operationId}`);
    }
  },

  views: {
    changes: {
      label: "Changes",
      shortLabel: "Git",
      scope: "workspace",
      placement: "inspector",
      open: (context) => openChangesView(service, context),
    },
  },

  /** The branch, and how many files differ from HEAD — the old status bar. */
  statusItems: async (context: UiContext): Promise<StatusItem[]> => {
    try {
      const status = await service.status(context.workspacePath);
      return [
        {
          id: "git.branch",
          label: status.clean
            ? status.branch
            : `${status.branch} (${status.files.length})`,
          tone: status.clean ? "default" : "accent",
          icon: "git-branch",
          view: "changes",
        },
      ];
    } catch {
      // Not a repository, or git is missing: the titlebar simply says nothing.
      return [];
    }
  },

  commands: () => [
    {
      id: "git.changes",
      label: "Show Git changes",
      keywords: ["git", "changes", "diff", "commit", "push"],
      icon: "git-branch",
      view: "changes",
    },
  ],

  toolPresentation: {
    labels: { git_status: "Git status" },
    icons: { git_status: "git-branch" },
  },
});

function filePath(input: unknown) {
  const path = (input as { path?: unknown } | null)?.path;
  if (typeof path !== "string" || !path)
    throw new Error("File path is required");
  return path;
}

async function isInRepository(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await service.status(workspacePath, signal);
    return true;
  } catch {
    return false;
  }
}
