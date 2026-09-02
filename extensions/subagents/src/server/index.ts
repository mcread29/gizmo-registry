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

export const gizmoExtension = {
  id: "subagents",
  name: "Subagents",
  async list() {
    return [descriptor()];
  },
  async invoke(
    _workspacePath: string,
    extensionId: string,
    operationId: string,
  ): Promise<unknown> {
    if (extensionId !== "subagents") {
      throw new Error(`Extension is not installed: ${extensionId}`);
    }
    if (operationId !== "snapshot") {
      throw new Error(
        `Extension subagents does not expose operation: ${operationId}`,
      );
    }
    return readMergedSubagentState();
  },
};
