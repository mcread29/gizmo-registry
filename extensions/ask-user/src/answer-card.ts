/**
 * The ask_user result card, as a view the host renders: the question, the
 * options with the chosen one (or the written answer) marked. The question itself
 * is still asked through Gizmo's generic select/input bridge.
 */

import { gizmoView, type View } from "@gizmo/extension-api";

export interface AskUserAnswer {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
}

export function answerView(details: AskUserAnswer): View {
  const { question, options, answer, wasCustom } = details;
  const items: { id: string; label: string; detail?: string }[] = options.map(
    (label, index) => ({
      id: `option-${index + 1}`,
      label,
    }),
  );
  // A written answer sits under the options and is marked the same way a
  // picked one is, so the card reads as the choices and what came of them.
  if (answer !== null && wasCustom)
    items.push({ id: "written", label: answer, detail: "Written" });
  const picked =
    answer === null
      ? -1
      : wasCustom
        ? items.length - 1
        : options.indexOf(answer);
  const blocks: View["blocks"] = [
    { type: "text", text: question },
    {
      type: "list",
      id: "options",
      items,
      ...(picked >= 0 ? { selectedId: items[picked]!.id } : {}),
    },
  ];
  if (answer === null)
    blocks.push({
      type: "text",
      text: "Dismissed without an answer",
      tone: "muted",
    });
  return {
    title: "Ask the user",
    status: answer === null ? "warning" : "success",
    blocks,
  };
}

export function answerCard(details: AskUserAnswer) {
  return gizmoView(answerView(details));
}
