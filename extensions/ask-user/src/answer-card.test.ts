import { describe, expect, it } from "vitest";
import { parseView } from "@gizmo/extension-api";
import { answerCard, answerView } from "./answer-card.ts";

describe("ask_user card", () => {
  it("marks the chosen option and validates as a view", () => {
    const view = answerView({
      question: "Which way?",
      options: ["Left", "Right"],
      answer: "Right",
      wasCustom: false,
    });
    expect(parseView(view)).toEqual(view);
    expect(view.blocks[1]).toMatchObject({ selectedId: "option-2" });
    expect(answerCard({
      question: "Which way?",
      options: ["Left", "Right"],
      answer: null,
      wasCustom: false,
    })).toHaveProperty("gizmoDisplay");
  });

  it("reports a dismissal", () => {
    const view = answerView({
      question: "Which way?",
      options: ["Left", "Right"],
      answer: null,
      wasCustom: false,
    });
    expect(parseView(view)).toEqual(view);
    expect(view.status).toBe("warning");
  });
});
