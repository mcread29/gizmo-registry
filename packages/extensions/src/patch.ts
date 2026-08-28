/**
 * Minimal unified-diff application, used only to undo a change the agent made.
 *
 * This is deliberately separate from the app's `diff.ts`, which classifies and
 * numbers lines for display and never touches a file. This module answers a
 * different question — does the recorded patch still describe what is on disk,
 * and what did the file look like before it? — and refuses to guess when the
 * answer is no.
 */

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** Raw hunk body lines, each still carrying its ' ', '+' or '-' prefix. */
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
    // "\ No newline at end of file" annotates the previous line, not content.
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
    // Anything else ends the hunk body (a second file header, for instance).
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

/**
 * Returns `content` with every hunk undone. Throws PatchMismatchError when the
 * file no longer matches what the patch says it should, which is the common
 * case after a later edit touched the same lines.
 */
export function revertPatch(content: string, patch: string): string {
  const hunks = parseHunks(patch);
  if (hunks.length === 0) {
    throw new PatchMismatchError("The recorded change contains no hunks");
  }

  const lines = content.split("\n");
  // Applied last-first so earlier offsets stay valid as the length changes.
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
      !found.every((l, i) => l === after[i])
    ) {
      throw new PatchMismatchError(
        `The file has changed since this edit (line ${hunk.newStart})`,
      );
    }
    lines.splice(start, after.length, ...before);
  }
  return lines.join("\n");
}
