import type { ExtensionDescriptor } from "@gizmo/protocol";
import type { ExtensionContext, GizmoServerExtension } from "@gizmo/extensions";
import { GitService } from "./git-service";

const apiVersion = 1;

const service = new GitService();

/** Git's single entry point into Gizmo's generic extension contract. */
function descriptor(): ExtensionDescriptor {
  return {
    id: "git",
    name: "Git",
    version: "0.0.0",
    apiVersion,
    capabilities: ["status", "stage", "commit", "push"],
    operations: [
      {
        id: "commit-context",
        mutates: false,
        requiresConfirmation: false,
      },
      { id: "status", mutates: false, requiresConfirmation: false },
      { id: "stage", mutates: true, requiresConfirmation: false },
      { id: "unstage", mutates: true, requiresConfirmation: false },
      {
        id: "commit",
        mutates: true,
        requiresConfirmation: false,
      },
      {
        id: "push-state",
        mutates: false,
        requiresConfirmation: false,
      },
      {
        id: "push",
        mutates: true,
        // Pushing publishes work to a shared remote; the caller must say so.
        requiresConfirmation: true,
      },
    ],
  };
}

/** Git's single entry point into Gizmo's generic extension contract. */
export const gizmoExtension: GizmoServerExtension = {
  id: "git",
  name: "Git",
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
};

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
