import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExtensionDescriptor } from "@gizmo/protocol";
import type { ProjectService } from "./project-service";

export interface ExtensionContext {
  workspacePath: string;
  confirm(kind: string): Promise<boolean>;
}

/**
 * A self-contained integration, discovered and loaded by id. Every capability
 * is optional — an extension contributes whichever of these it actually has:
 * workspace detection and tools/system prompt, live RPC-style operations for
 * the UI, or a project process (status/watch/open/revert).
 */
export interface GizmoServerExtension {
  id: string;
  name: string;
  /**
   * Absolute path to the extension's own package root. Skills and prompt
   * templates the package ships are discovered from here using Pi's package
   * convention, so an extension never needs a parallel Gizmo skill system.
   */
  packageRoot?: string;
  systemPrompt?: string;
  createTools?(context: ExtensionContext): ToolDefinition[];
  list?(
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<ExtensionDescriptor[]>;
  invoke?(
    workspacePath: string,
    extensionId: string,
    operationId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
  createProjectService?(): ProjectService;
}

export interface ActiveExtensions {
  extensions: GizmoServerExtension[];
  systemPrompt?: string;
  tools: ToolDefinition[];
}
