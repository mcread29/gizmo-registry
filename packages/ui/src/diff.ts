export type DiffLineKind =
  "file" | "range" | "added" | "removed" | "context" | "meta";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Present on replaced lines, marking the part that actually differs. */
  segments?: DiffSegment[];
}

const rangeHeader = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** How much of a replaced line must be unchanged before marking the rest. */
const sharedRatio = 0.3;

/**
 * Parses a unified diff into rows with line numbers. Prefix characters are only
 * meaningful inside a hunk, so `---`/`+++` file headers and any content line
 * that happens to begin with a dash are classified by position, not by guess.
 */
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const text of diff.split("\n")) {
    const range = rangeHeader.exec(text);
    if (range) {
      oldLine = Number(range[1]);
      newLine = Number(range[2]);
      inHunk = true;
      lines.push({ kind: "range", text });
      continue;
    }
    if (!inHunk) {
      lines.push({
        kind:
          text.startsWith("---") ||
          text.startsWith("+++") ||
          text.startsWith("diff ")
            ? "file"
            : "meta",
        text,
      });
      continue;
    }
    if (text.startsWith("\\")) {
      lines.push({ kind: "meta", text });
      continue;
    }
    if (text.startsWith("+")) {
      lines.push({ kind: "added", text: text.slice(1), newLine: newLine++ });
      continue;
    }
    if (text.startsWith("-")) {
      lines.push({ kind: "removed", text: text.slice(1), oldLine: oldLine++ });
      continue;
    }
    lines.push({
      kind: "context",
      text: text.startsWith(" ") ? text.slice(1) : text,
      oldLine: oldLine++,
      newLine: newLine++,
    });
  }
  // A trailing newline in the payload is not a row.
  if (lines.at(-1)?.text === "" && lines.at(-1)?.kind === "context") {
    lines.pop();
  }
  markWordChanges(lines);
  return lines;
}

/**
 * Pairs each run of removed lines with the added run that replaced it and marks
 * the differing span within each pair. A one-character change highlighted as a
 * whole line makes the reader hunt for what moved.
 */
function markWordChanges(lines: DiffLine[]): void {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.kind !== "removed") continue;
    const start = index;
    while (lines[index]?.kind === "removed") index++;
    const removed = lines.slice(start, index);
    const addedStart = index;
    while (lines[index]?.kind === "added") index++;
    const added = lines.slice(addedStart, index);

    const pairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair++) {
      const before = removed[pair]!;
      const after = added[pair]!;
      const [beforeSegments, afterSegments] = splitChange(
        before.text,
        after.text,
      );
      if (beforeSegments) before.segments = beforeSegments;
      if (afterSegments) after.segments = afterSegments;
    }
    index--;
  }
}

/** Undefined when the two lines share nothing worth highlighting. */
function splitChange(
  before: string,
  after: string,
): [DiffSegment[] | undefined, DiffSegment[] | undefined] {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  /*
   * Marking is only worth it when most of the line is genuinely shared.
   * "alpha" and "beta" end in the same letter; highlighting all but that
   * letter is noise, and the line colour already says the line was replaced.
   */
  const shared = prefix + suffix;
  const longest = Math.max(before.length, after.length);
  if (shared === 0 || shared < longest * sharedRatio) {
    return [undefined, undefined];
  }
  if (prefix === before.length && prefix === after.length) {
    return [undefined, undefined];
  }
  return [segments(before, prefix, suffix), segments(after, prefix, suffix)];
}

function segments(text: string, prefix: number, suffix: number): DiffSegment[] {
  const middle = text.slice(prefix, text.length - suffix);
  return [
    { text: text.slice(0, prefix), changed: false },
    { text: middle, changed: true },
    { text: text.slice(text.length - suffix), changed: false },
  ].filter((segment) => segment.text !== "");
}

export interface DiffStat {
  added: number;
  removed: number;
}

export function diffStat(lines: DiffLine[]): DiffStat {
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}
