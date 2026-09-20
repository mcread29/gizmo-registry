/**
 * Escalation journal: what a failed tier knew, written down before the next
 * tier starts.
 *
 * A failed run is evidence, not noise. Before a subagent climbs a rung, its
 * context is summarized and journalled here — one JSON line per climb — so the
 * successor can be handed the attempt instead of repeating it, and a human can
 * read what each tier actually did.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { subagentJournalDir } from "../../../packages/orchestration/src/agent-dir.ts";

/** Where the summary came from: a real compaction, or a mechanical digest. */
export type HandoffSource = "compaction" | "digest";

export interface EscalationEntry {
  at: number;
  subagentId: string;
  title: string;
  fromTier: string;
  toTier: string;
  fromModel?: string;
  toModel: string;
  /** Why the lower tier stopped. */
  failure: string;
  /** The compacted context handed to the successor. */
  summary: string;
  source: HandoffSource;
}

const MAX_SUMMARY_CHARS = 12_000;

export function journalPath(
  sessionId: string,
  subagentId: string,
  dir = subagentJournalDir(),
): string {
  return join(dir, `${sessionId}.${subagentId}.jsonl`);
}

/** Appends one climb to the journal. Journaling never fails a run. */
export function writeEscalation(
  sessionId: string,
  entry: EscalationEntry,
  dir = subagentJournalDir(),
): void {
  try {
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ...entry,
      summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
    });
    appendFileSync(
      journalPath(sessionId, entry.subagentId, dir),
      `${line}\n`,
      "utf8",
    );
  } catch {
    // Never let journalling break escalation.
  }
}

/** Every climb recorded for one subagent, oldest first. */
export function readEscalationJournal(
  sessionId: string,
  subagentId: string,
  dir = subagentJournalDir(),
): EscalationEntry[] {
  let raw: string;
  try {
    raw = readFileSync(journalPath(sessionId, subagentId, dir), "utf8");
  } catch {
    return [];
  }
  const entries: EscalationEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isEntry(value)) entries.push(value);
    } catch {
      // A corrupt line must not hide the rest of the journal.
    }
  }
  return entries;
}

/** Markdown rendering of one climb, for humans and for prompt hand-offs. */
export function formatEscalation(entry: EscalationEntry): string {
  const modelLine = entry.fromModel
    ? `${entry.fromModel} → ${entry.toModel}`
    : entry.toModel;
  return [
    `### ${entry.fromTier} → ${entry.toTier} (${modelLine})`,
    "",
    `Failed: ${entry.failure}`,
    "",
    entry.summary.trim(),
  ].join("\n");
}

function isEntry(value: unknown): value is EscalationEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EscalationEntry>;
  return (
    typeof candidate.at === "number" &&
    typeof candidate.subagentId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.fromTier === "string" &&
    typeof candidate.toTier === "string" &&
    typeof candidate.toModel === "string" &&
    typeof candidate.failure === "string" &&
    typeof candidate.summary === "string" &&
    (candidate.source === "compaction" || candidate.source === "digest")
  );
}
