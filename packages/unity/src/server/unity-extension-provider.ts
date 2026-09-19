import type { ExtensionDescriptor } from "@gizmo/extension-api";
import {
  invokeUnityExtension,
  listUnityCommands,
  listUnityExtensions,
  unityExtensionCommands,
  UnityRunner,
  type UnityCommandRunner,
} from "../../../unity-tools/src/index";

/** Adapts Unity Pipeline's extension commands to Gizmo's generic contract. */
export class UnityExtensionProvider {
  constructor(
    private readonly runner: UnityCommandRunner = new UnityRunner(),
  ) {}

  async list(
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<ExtensionDescriptor[]> {
    const commands = await listUnityCommands(this.runner, {
      projectPath: workspacePath,
      signal,
    });
    if (
      !commands.ok ||
      !commands.commands.some(
        ({ name }) => name === unityExtensionCommands.discoveryCommand,
      )
    )
      return [];
    const result = await listUnityExtensions(
      this.runner,
      workspacePath,
      signal,
    );
    const console = result.ok
      ? result.extensions.find(({ id }) => id === "com.gizmo.extras.console")
      : undefined;
    if (!console?.operations.some(({ id }) => id === "snapshot")) return [];
    return [
      {
        id: "unity",
        name: "Unity",
        version: console.version,
        apiVersion: 1,
        capabilities: ["unity.console"],
        operations: [
          {
            id: "console.snapshot",
            mutates: false,
            requiresConfirmation: false,
          },
        ],
      },
    ];
  }

  invoke(
    workspacePath: string,
    extensionId: string,
    operationId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (extensionId !== "unity" || operationId !== "console.snapshot") {
      return Promise.reject(
        new Error(`Unknown Unity operation: ${operationId}`),
      );
    }
    return invokeUnityExtension(
      this.runner,
      workspacePath,
      "com.gizmo.extras.console",
      "snapshot",
      input,
      signal,
    );
  }
}
