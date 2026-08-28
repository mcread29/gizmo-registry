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
    capabilities: ["status", "commit"],
    operations: [
      { id: "status", mutates: false, requiresConfirmation: false },
      {
        id: "commit",
        mutates: true,
        requiresConfirmation: false,
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
      case "commit": {
        const message =
          typeof (input as { message?: unknown } | null)?.message === "string"
            ? (input as { message: string }).message
            : "";
        return service.commitAll(workspacePath, message);
      }
      default:
        throw new Error(`Unknown Git operation: ${operationId}`);
    }
  },
};

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
