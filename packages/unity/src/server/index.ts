import type { GizmoServerExtension } from "./contracts";
import { UnityProjectService } from "./domain/unity-project-service";
import { unityDomain } from "./domain/unity-domain";
import { UnityExtensionProvider } from "./unity-extension-provider";

const extensionProvider = new UnityExtensionProvider();

/** Unity's single entry point into Gizmo's generic extension contract. */
export const gizmoExtension: GizmoServerExtension = {
  id: unityDomain.id!,
  name: unityDomain.name!,
  systemPrompt: unityDomain.systemPrompt,
  createTools: unityDomain.createTools,
  list: (workspacePath, signal) =>
    extensionProvider.list(workspacePath, signal),
  invoke: (workspacePath, extensionId, operationId, input, signal) =>
    extensionProvider.invoke(
      workspacePath,
      extensionId,
      operationId,
      input,
      signal,
    ),
  createProjectService: () => new UnityProjectService(),
};

export { UnityProjectService } from "./domain/unity-project-service";
export { UnityExtensionProvider } from "./unity-extension-provider";
export { unitySystemPrompt } from "./domain/unity-system-prompt";
