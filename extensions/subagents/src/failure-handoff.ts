/**
 * Builds the hand-off summary a failing subagent leaves for the successor
 * tier that continues its task, and journals the climb.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activeModel, type Subagent } from "./manager.ts";
import { traceDigest, type SuccessorHandoff } from "./handoff.ts";
import { writeEscalation, type HandoffSource } from "./journal.ts";
import type { Tier } from "./tiers.ts";
import { describeModel } from "./tier-setup.ts";
import { messageText } from "./message-text.ts";

/** What to ask a failing session for, so its successor inherits the attempt. */
const HANDOFF_INSTRUCTIONS = [
  "Summarize this run for a successor agent that will continue the same task on a stronger model.",
  "State the task as you understood it, what you investigated or changed (with file paths),",
  "what you concluded, and precisely where and why you stopped or failed.",
  "Be concrete and short; the successor sees only this summary and the original task.",
].join(" ");

/**
 * Compacts a failed run into a hand-off, journalling it before the next tier
 * starts. Compaction is best-effort: when it is unavailable the transcript is
 * digested mechanically, so a climb never loses the attempt it is climbing
 * from.
 */
export function createFailureSummarizer(
  getSessionContext: () => ExtensionContext | undefined,
) {
  return async (
    sub: Subagent,
    failure: string,
    nextTier: Tier,
  ): Promise<SuccessorHandoff | undefined> => {
    // The manager advances the rung before asking, so the new rung is current.
    const fromTier = sub.ladder[sub.rung - 1]?.tier ?? "base";
    const fromModel = describeModel(activeModel(sub));
    const toModel = describeModel(sub.ladder[sub.rung]?.model);
    let summary: string | undefined;
    let source: HandoffSource = "digest";
    try {
      const compacted = await sub.session.compact(HANDOFF_INSTRUCTIONS);
      if (compacted?.summary?.trim()) {
        summary = compacted.summary.trim();
        source = "compaction";
      }
    } catch {
      // Compaction can be disabled or the provider can fail; fall through.
    }
    if (!summary) {
      summary = traceDigest({
        task: sub.prompt,
        notes: sub.session.messages
          .map((message) => messageText(message))
          .filter((text) => text.length > 0),
        error: failure,
      });
    }
    const sessionId = getSessionContext()?.sessionManager.getSessionId();
    if (sessionId) {
      writeEscalation(sessionId, {
        at: Date.now(),
        subagentId: sub.id,
        title: sub.title,
        fromTier,
        toTier: nextTier,
        ...(fromModel ? { fromModel } : {}),
        toModel,
        failure,
        summary,
        source,
      });
    }
    return { fromTier, toTier: nextTier, failure, summary };
  };
}
