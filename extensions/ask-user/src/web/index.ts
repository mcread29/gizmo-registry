import AskUserToolResult from "./AskUserToolResult.svelte";

/**
 * Ask-user's web presentation, paired with the Pi extension of the same id.
 * The question card itself is Gizmo's generic bridge renderer (select/input
 * requests render there for every extension); this extension contributes the
 * tool's own presentation: its label, and a native rendering of the question
 * and the answer on the tool call.
 */
export const gizmoWebExtension = {
  id: "ask-user",
  labels: {
    ask_user: "Ask the user",
  },
  parametersFor: (name: string, parameters: [string, string][]) =>
    name === "ask_user"
      ? parameters.filter(([param]) => param === "question")
      : parameters,
  resultFor: (name: string) =>
    name === "ask_user" ? AskUserToolResult : undefined,
};
