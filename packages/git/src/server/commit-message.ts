/**
 * A commit message drafted by a model over the working tree's diff. The
 * model is the one the user picked in the extension's settings (a `model`
 * field, with its thinking level), falling back to whatever the host
 * offers when none is set.
 */

import { readModelSetting, type ViewContext } from "@gizmo/extension-api";

export const commitMessageModelKey = "commitMessageModel";

export const commitMessagePrompt = [
  "Write a commit message for my changes.",
  "Explain what were the changes and why the changes were done.",
  "Focus the most important changes.",
  "Use the present tense.",
  "Use a single word lowercase commit prefix.",
  "Hard wrap lines at 72 characters.",
  "Ensure the title is less than 50 (soft limit) and 70 (hard limit).",
  "Do not start any lines with the hash symbol.",
  "Only respond with the commit message.",
].join("\n");

/** Pi's text answer, minus the fences models add despite being asked not to. */
export function cleanCommitMessage(text: string): string {
  return text
    .trim()
    .replace(/^```(?:text)?\s*|\s*```$/g, "")
    .trim();
}

export async function suggestCommitMessage(
  context: Pick<ViewContext, "complete" | "settings">,
  diffContext: string,
): Promise<string> {
  if (!context.complete) {
    throw new Error("This Gizmo cannot draft commit messages for extensions");
  }
  const model = readModelSetting(context.settings[commitMessageModelKey]);
  const text = await context.complete({
    ...(model ? { model } : {}),
    systemPrompt: commitMessagePrompt,
    prompt: diffContext,
    maxTokens: 1500,
  });
  const message = cleanCommitMessage(text);
  if (!message) throw new Error("The model returned an empty commit message");
  return message;
}
