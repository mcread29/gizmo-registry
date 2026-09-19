/**
 * The ask_user result card, as a view the host renders: the question, the
 * options with the chosen one selected, and the answer. The question itself
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
  const blocks: View["blocks"] = [
    { type: "text", text: details.question },
    {
      type: "list",
      id: "options",
      items: details.options.map((label, index) => ({
        id: `option-${index + 1}`,
        label,
      })),
      ...(details.answer !== null && !details.wasCustom
        ? (() => {
            const index = details.options.indexOf(details.answer);
            return index >= 0 ? { selectedId: `option-${index + 1}` } : {};
          })()
        : {}),
    },
  ];
  blocks.push(
    details.answer === null
      ? {
          type: "text",
          text: "Dismissed without an answer",
          tone: "muted",
        }
      : {
          type: "text",
          text: details.wasCustom
            ? `Wrote: ${details.answer}`
            : details.answer,
          tone: "success",
        },
  );
  return {
    title: "Ask the user",
    status: details.answer === null ? "warning" : "success",
    blocks,
  };
}

export function answerCard(details: AskUserAnswer) {
  return gizmoView(answerView(details));
}
