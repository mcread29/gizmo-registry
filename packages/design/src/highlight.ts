import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cs from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/*
 * Registered by hand rather than pulling the full highlight.js bundle: these are
 * the languages a Unity project actually produces. Anything else falls through
 * to plain escaped text.
 */
const languages = {
  bash,
  csharp: cs,
  css,
  diff,
  ini,
  javascript,
  json,
  typescript,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(languages)) {
  hljs.registerLanguage(name, definition);
}

const aliases: Record<string, string> = {
  c: "csharp",
  "c#": "csharp",
  cs: "csharp",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  html: "xml",
  uxml: "xml",
  uss: "css",
  toml: "ini",
  patch: "diff",
};

export function resolveLanguage(language: string): string | undefined {
  const name = aliases[language] ?? language;
  return hljs.getLanguage(name) ? name : undefined;
}

/**
 * Returns highlighted HTML (already escaped by highlight.js), or undefined when
 * the language is not one we registered.
 */
export function highlightCode(
  code: string,
  language: string,
): string | undefined {
  const name = resolveLanguage(language);
  if (!name) return undefined;
  return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
}
