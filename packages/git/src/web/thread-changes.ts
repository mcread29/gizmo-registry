import type { ConversationMessage, ToolCallView } from "@gizmo/protocol";
import { diffStat, parseDiff } from "@gizmo/ui";
import { recordValue, stringValue } from "@gizmo/design/format";

export interface FileChange {
  toolCallId: string;
  patch: string;
  added: number;
  removed: number;
  /** Tool status, so an in-flight or failed write is not offered for revert. */
  status: ToolCallView["status"];
}

export interface ChangedFile {
  file: string;
  changes: FileChange[];
  added: number;
  removed: number;
}

/**
 * Every file the agent wrote during this thread, newest change last. Derived
 * from the transcript rather than tracked separately, so it cannot disagree
 * with what the conversation shows.
 */
export function threadChanges(messages: ConversationMessage[]): ChangedFile[] {
  const byFile = new Map<string, ChangedFile>();

  for (const message of messages) {
    for (const tool of message.tools) {
      if (tool.name !== "edit" && tool.name !== "write") continue;
      const patch = changePatch(tool);
      if (!patch) continue;
      const file = changedFileName(tool, patch);
      if (!file) continue;
      const { added, removed } = diffStat(parseDiff(patch));
      const entry = byFile.get(file) ?? {
        file,
        changes: [],
        added: 0,
        removed: 0,
      };
      entry.changes.push({
        toolCallId: tool.id,
        patch,
        added,
        removed,
        status: tool.status,
      });
      entry.added += added;
      entry.removed += removed;
      byFile.set(file, entry);
    }
  }

  return [...byFile.values()];
}

export function changeTotals(files: ChangedFile[]) {
  return files.reduce(
    (total, file) => ({
      added: total.added + file.added,
      removed: total.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
}

function changePatch(tool: ToolCallView): string | undefined {
  return (
    stringValue(recordValue(tool.result, "patch")) ??
    stringValue(recordValue(tool.result, "diff"))
  );
}

/**
 * Tool results do not agree on where the path lives, and the patch header
 * always carries it, so the header is the fallback of record.
 */
function changedFileName(
  tool: ToolCallView,
  patch: string,
): string | undefined {
  for (const key of ["file", "path", "filePath", "relativePath"]) {
    const value = stringValue(recordValue(tool.result, key));
    if (value) return value;
  }
  return patchFileName(patch);
}

export function patchFileName(patch: string): string | undefined {
  for (const line of patch.split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    const value = line.slice(4).trim().split("\t")[0];
    if (!value || value === "/dev/null") continue;
    return value.replace(/^[ab]\//, "");
  }
}
