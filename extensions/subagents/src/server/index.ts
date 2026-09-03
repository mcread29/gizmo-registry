/**
 * Gizmo agent-server integration for the subagents extension.
 *
 * Loaded in the agent-server process (not Pi's), so it cannot see the live
 * SubagentManager. It answers web `list`/`invoke` calls from the per-session
 * state snapshots the Pi extension writes (see ../state.ts).
 */

import { readMergedSubagentState } from "../state.ts";

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

const OPERATIONS = [
  { id: "snapshot", mutates: false, requiresConfirmation: false },
] as const;

function descriptor(): ExtensionDescriptor {
  return {
    id: "subagents",
    name: "Subagents",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: [],
    operations: OPERATIONS.map((operation) => ({ ...operation })),
  };
}

function sessionIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { sessionId } = input as { sessionId?: unknown };
  return typeof sessionId === "string" && sessionId ? sessionId : undefined;
}

export const gizmoExtension = {
  id: "subagents",
  name: "Subagents",
  async list() {
    return [descriptor()];
  },
  async invoke(
    workspacePath: string,
    extensionId: string,
    operationId: string,
    input?: unknown,
  ): Promise<unknown> {
    if (extensionId !== "subagents") {
      throw new Error(`Extension is not installed: ${extensionId}`);
    }
    if (operationId !== "snapshot") {
      throw new Error(
        `Extension subagents does not expose operation: ${operationId}`,
      );
    }
    // Scoped to the workspace and, when the panel says which, the open
    // thread; other threads keep their own subagents to themselves.
    const sessionId = sessionIdOf(input);
    return readMergedSubagentState({
      workspacePath,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  },
};
