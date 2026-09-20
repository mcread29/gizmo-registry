import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (!("type" in block)) return "";

      if (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }

      if (block.type === "image") return "[image]";

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function timestampSlug(date = new Date()) {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("dump", {
    description:
      "Write all user and assistant messages in this thread to a markdown file (default: ./dumps/<timestamp>.md; pass a path to override)",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const sections = ctx.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.message)
        .filter(
          (message) => message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({
          role: message.role,
          content: textFromContent(message.content).trim(),
        }))
        .filter(({ content }) => content)
        .map(({ role, content }) => `## ${role.toUpperCase()}\n\n${content}`);

      if (sections.length === 0) {
        ctx.ui.notify("No user or assistant messages to dump", "info");
        return;
      }

      const trimmedArgs = args?.trim();
      const target = trimmedArgs
        ? resolve(trimmedArgs)
        : join(process.cwd(), "dumps", `${timestampSlug()}.md`);

      const sessionFile = ctx.sessionManager.getSessionFile();
      const header = [
        "# pi transcript dump",
        "",
        `- dumped: ${new Date().toISOString()}`,
        `- session: ${sessionFile ?? "ephemeral"}`,
        `- messages: ${sections.length}`,
        "",
      ].join("\n");

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${header}${sections.join("\n\n---\n\n")}\n`, {
        encoding: "utf8",
      });

      ctx.ui.notify(`Dumped ${sections.length} messages to ${target}`, "info");
    },
  });
}
