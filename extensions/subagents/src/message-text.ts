/**
 * Flattens one session message to the plain text the transcript views, the
 * result summary and the escalation digest all read.
 *
 * Shared so a hand-off sees exactly what the Subagents tab shows.
 */
export function messageText(message: unknown) {
  const value = message as {
    role?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
        }>;
  };
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "thinking") return part.thinking ?? "";
      if (part.type === "toolCall") return `[tool] ${part.name ?? "unknown"}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
