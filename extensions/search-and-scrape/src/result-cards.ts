/**
 * Result cards for `search` and `scrape`, as views the host renders. They
 * replace the two Svelte components the extension used to ship.
 */

import { gizmoView, type Block, type View } from "@gizmo/extension-api";

const SNIPPET_MAX = 400;
const PREVIEW_MAX = 8_000;

export interface SearchHit {
  title?: string;
  url?: string;
  content?: string;
}

/** `title` and `label` are capped at 500 characters by the schema. */
function clip(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function hostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function searchView(details: {
  query: string;
  results: SearchHit[];
  numberOfResults: number;
  searxngUrl?: string;
}): View {
  const count = details.numberOfResults;
  return {
    title: clip(`Search: ${details.query}`),
    status: details.results.length === 0 ? "warning" : "success",
    blocks: [
      ...(!details.results.length
        ? [
            {
              type: "text",
              text: clip(`No results for “${details.query}”.`),
              tone: "muted",
            } as Block,
          ]
        : details.results.slice(0, 100).map((hit): Block => ({
            type: "section",
            title: clip(hit.title ?? hit.url ?? "Untitled"),
            blocks: [
              ...(hit.url ? [urlBlock(hit.url, hostname(hit.url))] : []),
              ...(hit.content
                ? [
                    {
                      type: "text",
                      text: hit.content.slice(0, SNIPPET_MAX),
                    } as Block,
                  ]
                : []),
            ],
          }))),
      {
        type: "text",
        text: `${count} result${count === 1 ? "" : "s"}${
          details.searxngUrl
            ? ` · ${details.searxngUrl.replace(/^https?:\/\//, "")}`
            : ""
        }`,
        tone: "muted",
      },
    ],
  };
}

function urlBlock(url: string, title = url): Block {
  return /^https?:\/\//.test(url) && url.length <= 2000
    ? { type: "link", text: clip(title), url }
    : { type: "text", text: url.slice(0, 20000) };
}

export function scrapeView(details: {
  url: string;
  markdownLength: number;
  markdownPreview: string;
  fullOutputPath?: string;
}): View {
  return {
    title: clip(details.url),
    status: "success",
    blocks: [
      urlBlock(details.url),
      {
        type: "keyValue",
        entries: [
          { label: "URL", value: details.url },
          {
            label: "Size",
            value: `${details.markdownLength.toLocaleString()} chars`,
          },
          ...(details.fullOutputPath
            ? [
                {
                  label: "Full page",
                  value: details.fullOutputPath,
                  tone: "muted" as const,
                },
              ]
            : []),
        ],
      },
      {
        type: "markdown",
        markdown:
          details.markdownPreview.length > PREVIEW_MAX
            ? `${details.markdownPreview.slice(0, PREVIEW_MAX)}\n\n[preview truncated]`
            : details.markdownPreview,
      },
    ],
  };
}

export function errorView(title: string, message: string): View {
  return {
    title,
    status: "error",
    blocks: [{ type: "text", text: message, tone: "error" }],
  };
}

export const searchCard = (details: Parameters<typeof searchView>[0]) =>
  gizmoView(searchView(details));
export const scrapeCard = (details: Parameters<typeof scrapeView>[0]) =>
  gizmoView(scrapeView(details));
export const errorCard = (title: string, message: string) =>
  gizmoView(errorView(title, message));
