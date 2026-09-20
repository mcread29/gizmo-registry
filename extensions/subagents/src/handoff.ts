/**
 * Turning a failed run into something the next tier can start from.
 *
 * Kept pure and free of Pi imports so it can be tested without a session: it
 * takes the strings extracted from a transcript and returns the digest or the
 * successor prompt.
 */

/** What a failed run did, already flattened to text. */
export interface RunTrace {
  /** The task as first given to the subagent. */
  task: string;
  /** Assistant turns, tool calls, and results, in order, newest last. */
  notes: string[];
  error?: string;
}

const MAX_NOTE_CHARS = 1_200;
const MAX_DIGEST_CHARS = 8_000;
const MAX_NOTES_KEPT = 40;

/**
 * Mechanical digest of a run: the task, what happened, and why it stopped.
 * Used when compaction cannot summarize (disabled, or the provider failed), so
 * an escalation always hands something over.
 */
export function traceDigest(
  trace: RunTrace,
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? MAX_DIGEST_CHARS;
  const notes = trace.notes.slice(-MAX_NOTES_KEPT).map((note) => {
    const flat = note.replace(/\s+/g, " ").trim();
    return flat.length > MAX_NOTE_CHARS
      ? `${flat.slice(0, MAX_NOTE_CHARS)}…`
      : flat;
  });
  const lines = [
    "Task:",
    trace.task.trim() || "(no task recorded)",
    "",
    "What happened:",
    ...(notes.length > 0
      ? notes.map((note) => `- ${note}`)
      : ["- (no activity recorded)"]),
  ];
  if (trace.error) lines.push("", `Why it stopped: ${trace.error}`);
  const digest = lines.join("\n");
  return digest.length > maxChars ? `${digest.slice(0, maxChars)}…` : digest;
}

export interface SuccessorHandoff {
  fromTier: string;
  toTier: string;
  failure: string;
  summary: string;
}

/**
 * The prompt for the next tier: the original task, then the compacted memory
 * of the attempt that failed it.
 */
export function buildSuccessorPrompt(
  task: string,
  handoff: SuccessorHandoff,
): string {
  return [
    task.trim(),
    "",
    "---",
    "",
    `## Hand-off from the ${handoff.fromTier} tier`,
    "",
    `A previous attempt on the ${handoff.fromTier} tier failed: ${handoff.failure}`,
    `Its context was summarized and journalled. You are the ${handoff.toTier} tier: start from what it learned instead of repeating it.`,
    "",
    handoff.summary.trim(),
    "",
    "Continue the task from here. Say what you are reusing and what you are changing, and deliver the same report that was asked for.",
  ].join("\n");
}
