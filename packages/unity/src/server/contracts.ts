import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface ExtensionDescriptor {
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

export interface ExtensionContext {
  workspacePath: string;
  confirm(kind: string): Promise<boolean>;
}

/**
 * Opaque to Gizmo core: since protocol v26 the shell stores and routes
 * project-service status payloads without interpreting them; Unity owns
 * the shape, validation, and errors (see `src/web/unity-wire.ts`).
 */
export type ProjectStatus = unknown;

export interface ProjectWatchListeners {
  status: (status: ProjectStatus) => void;
}

export interface ProjectService {
  getStatus(projectPath: string): Promise<ProjectStatus>;
  watchStatus(
    projectPath: string,
    listeners: ProjectWatchListeners,
  ): Promise<ProjectStatus>;
  openProject(projectPath: string): Promise<unknown>;
  revertFile(projectPath: string, file: string, patch: string): Promise<void>;
  dispose(): void;
}

export interface GizmoServerExtension {
  id: string;
  name: string;
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

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

const hunkHeader = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;

  for (const line of patch.split("\n")) {
    const header = hunkHeader.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[3]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\")) continue;
    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line === ""
    ) {
      current.lines.push(line === "" ? " " : line);
      continue;
    }
    current = undefined;
  }
  return hunks;
}

export class PatchMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchMismatchError";
  }
}

export function revertPatch(content: string, patch: string): string {
  const hunks = parseHunks(patch);
  if (hunks.length === 0) {
    throw new PatchMismatchError("The recorded change contains no hunks");
  }

  const lines = content.split("\n");
  for (const hunk of [...hunks].reverse()) {
    const after = hunk.lines
      .filter((line) => !line.startsWith("-"))
      .map((line) => line.slice(1));
    const before = hunk.lines
      .filter((line) => !line.startsWith("+"))
      .map((line) => line.slice(1));
    const start = hunk.newStart - 1;
    const found = lines.slice(start, start + after.length);
    if (
      found.length !== after.length ||
      !found.every((line, index) => line === after[index])
    ) {
      throw new PatchMismatchError(
        `The file has changed since this edit (line ${hunk.newStart})`,
      );
    }
    lines.splice(start, after.length, ...before);
  }
  return lines.join("\n");
}
