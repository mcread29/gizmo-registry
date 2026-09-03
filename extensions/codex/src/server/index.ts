/**
 * Gizmo agent-server integration for the Codex extension.
 *
 * Answers the web UI's single `usage` operation: read the local Codex CLI
 * sign-in, fetch usage/rate limits from ChatGPT's Codex backend, and return
 * a parsed snapshot. Usage is account-scoped, not workspace-scoped, so the
 * workspace path is ignored here.
 */

import { createUsageService } from "./usage-service.ts";

/** Mirrors Gizmo's `ExtensionDescriptor` without importing `@gizmo/protocol`. */
interface ExtensionDescriptor {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
  operations: Array<{
    id: string;
    mutates: boolean;
    requiresConfirmation: boolean;
  }>;
}

/** Mirrors Gizmo's `GizmoServerExtension` without importing `@gizmo/extensions`. */
interface GizmoServerExtension {
  id: string;
  name: string;
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
}

const apiVersion = 1;

const usageService = createUsageService();

function descriptor(): ExtensionDescriptor {
  return {
    id: "codex",
    name: "Codex",
    version: "1.0.0",
    apiVersion,
    capabilities: [],
    operations: [{ id: "usage", mutates: false, requiresConfirmation: false }],
  };
}

export const gizmoExtension: GizmoServerExtension = {
  id: "codex",
  name: "Codex",
  list: async () => [descriptor()],
  invoke: async (
    _workspacePath: string,
    extensionId: string,
    operationId: string,
    _input: unknown,
    signal?: AbortSignal,
  ) => {
    if (extensionId !== "codex") {
      throw new Error(`Extension is not installed: ${extensionId}`);
    }
    if (operationId !== "usage") {
      throw new Error(
        `Extension codex does not expose operation: ${operationId}`,
      );
    }
    return usageService.getUsage(signal);
  },
};
