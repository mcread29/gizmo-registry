import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineExtension } from "@gizmo/extension-api";
import {
  errorCard,
  scrapeCard,
  searchCard,
  type SearchHit,
} from "./src/result-cards.ts";

/**
 * Registers the extension with Gizmo's host so it appears under Settings →
 * Extensions with an enable/disable toggle. It contributes no views: search
 * and scrape are stateless tools whose results are rendered as cards from the
 * tool result itself.
 */
export const gizmoExtension = defineExtension({
  id: "search-and-scrape",
  name: "Search & Scrape",
  toolPresentation: {
    labels: { search: "Search", scrape: "Scrape" },
    icons: { search: "search", scrape: "file-text" },
    parameters: {
      search: ["query", "limit", "source"],
      scrape: ["url", "onlyMainContent", "waitFor", "timeout"],
    },
  },
});

const PI_ENV_PATH = join(homedir(), ".pi", "agent", ".env");
const MAX_ERROR_BODY_BYTES = 4_096;
const MAX_TIMEOUT_MS = 300_000;

type SearchSource = "web" | "news" | "images";
type JsonObject = Record<string, unknown>;

function readEnvValue(name: string) {
  if (process.env[name]) return process.env[name];

  let envText = "";

  try {
    envText = readFileSync(PI_ENV_PATH, "utf8");
  } catch {
    return undefined;
  }

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match || match[1] !== name) continue;

    const value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    return value.replace(/\s+#.*$/, "");
  }

  return undefined;
}

function getBaseUrl(envName: string, fallback: string) {
  return (readEnvValue(envName) || fallback).replace(/\/+$/, "");
}

function getConfiguredTimeout(envName: string, fallback: number) {
  const configured = Number(readEnvValue(envName));
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.min(Math.floor(configured), MAX_TIMEOUT_MS);
}

function sourceToCategory(source: SearchSource | undefined) {
  if (source === "news") return "news";
  if (source === "images") return "images";
  return "general";
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(
    Math.min(Math.max(Math.floor(timeoutMs), 1), MAX_TIMEOUT_MS),
  );
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}

function redactSecrets(text: string) {
  let redacted = text.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    "Bearer [REDACTED]",
  );

  const token = readEnvValue("CRAWL4AI_API_TOKEN");
  if (token) redacted = redacted.split(token).join("[REDACTED]");

  return redacted;
}

function summarizeBody(body: string) {
  const encoded = Buffer.from(body);
  const truncated = encoded.byteLength > MAX_ERROR_BODY_BYTES;
  const summary = encoded.subarray(0, MAX_ERROR_BODY_BYTES).toString("utf8");
  return `${redactSecrets(summary)}${truncated ? "… [response body truncated]" : ""}`;
}

async function throwHttpError(service: string, response: Response) {
  const body = summarizeBody(await response.text());
  throw new Error(
    `${service} returned HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
  );
}

async function readJsonObject(service: string, response: Response) {
  const body = await response.text();
  let value: unknown;

  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(
      `${service} returned invalid JSON: ${summarizeBody(body) || "empty response"}`,
    );
  }

  if (!isJsonObject(value)) {
    throw new Error(`${service} returned a non-object JSON response.`);
  }

  return value;
}

function formatToolOutput(prefix: string, output: string) {
  const truncation = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return { content: truncation.content, fullOutputPath: undefined };
  }

  const outputDirectory = join(tmpdir(), "pi-web-tools");
  const fullOutputPath = join(outputDirectory, `${prefix}-${randomUUID()}.txt`);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(fullOutputPath, output, { encoding: "utf8", mode: 0o600 });

  const notice =
    `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`;

  return { content: `${truncation.content}${notice}`, fullOutputPath };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search Web",
    description:
      "Search the web with the local self-hosted SearXNG instance. Returns web/news/image results, truncated to 50KB or 2,000 lines when necessary.",
    promptSnippet: "Search the web with local SearXNG for current information.",
    promptGuidelines: [
      "Use search when the user asks for current web information, discovery, or sources beyond the local workspace.",
      "Use scrape after search when you need the full markdown content of a specific page.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The web search query." }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return. Defaults to 5.",
          minimum: 1,
          maximum: 20,
        }),
      ),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      scrapeResults: Type.Optional(
        Type.Boolean({
          description:
            "Deprecated. Use the scrape tool on specific result URLs instead.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const baseUrl = getBaseUrl("SEARXNG_URL", "http://127.0.0.1:8080");
        const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
        const url = new URL("/search", baseUrl);
        url.searchParams.set("q", params.query);
        url.searchParams.set("format", "json");
        url.searchParams.set("categories", sourceToCategory(params.source));

        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Searching local SearXNG for: ${params.query}`,
            },
          ],
          details: { url: url.toString() },
        });

        const response = await fetch(url, {
          signal: withTimeout(
            signal,
            getConfiguredTimeout("SEARXNG_TIMEOUT_MS", 30_000),
          ),
          headers: { "User-Agent": "pi-search-extension/1.0" },
        });

        if (!response.ok) await throwHttpError("SearXNG", response);

        const result = await readJsonObject("SearXNG", response);
        const results = Array.isArray(result.results)
          ? result.results.slice(0, limit)
          : [];
        const normalized = {
          ...result,
          results,
          number_of_results:
            typeof result.number_of_results === "number"
              ? result.number_of_results
              : results.length,
          searxng_url: baseUrl,
          scrapeResults_notice: params.scrapeResults
            ? "Search does not scrape result pages; use the scrape tool on chosen URLs."
            : undefined,
        };
        const output = formatToolOutput("search", stringify(normalized));

        return {
          content: [{ type: "text", text: output.content }],
          details: searchCard({
            query: params.query,
            results: results as SearchHit[],
            numberOfResults: normalized.number_of_results,
            searxngUrl: baseUrl,
          }),
        };
      } catch (error) {
        const message = redactSecrets(asErrorMessage(error));
        return {
          content: [
            {
              type: "text",
              text: `SearXNG search failed: ${message}`,
            },
          ],
          details: errorCard("Search failed", message),
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "scrape",
    label: "Scrape Page",
    description:
      "Grab one page with local Crawl4AI and return main-content or raw Markdown, truncated to 50KB or 2,000 lines when necessary.",
    promptSnippet:
      "Fetch a URL's page content as markdown with local Crawl4AI.",
    promptGuidelines: [
      "Use scrape when you need the full readable markdown content of a known URL.",
      "Prefer scrape over bash/fetch for web pages because scrape returns cleaned markdown suitable for agent context.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch." }),
      onlyMainContent: Type.Optional(
        Type.Boolean({
          description: "Only return the main page content. Defaults to true.",
        }),
      ),
      waitFor: Type.Optional(
        Type.Number({
          description:
            "Milliseconds to wait before capturing content, useful for JS-heavy pages. Currently accepted for compatibility; Crawl4AI /md may ignore it.",
          minimum: 0,
          maximum: 120_000,
        }),
      ),
      timeout: Type.Optional(
        Type.Number({
          description:
            "Request timeout in milliseconds. Defaults to CRAWL4AI_TIMEOUT_MS or 120000.",
          minimum: 1_000,
          maximum: MAX_TIMEOUT_MS,
        }),
      ),
      includeMetadata: Type.Optional(
        Type.Boolean({
          description:
            "Append page metadata to the markdown output. Defaults to false. Full metadata is always available in details.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const baseUrl = getBaseUrl("CRAWL4AI_URL", "http://127.0.0.1:11235");
        const endpoint = new URL("/md", baseUrl);
        const timeout =
          params.timeout ??
          getConfiguredTimeout("CRAWL4AI_TIMEOUT_MS", 120_000);

        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Scraping page with local Crawl4AI: ${params.url}`,
            },
          ],
          details: { endpoint: endpoint.toString() },
        });

        const apiToken = readEnvValue("CRAWL4AI_API_TOKEN");
        const response = await fetch(endpoint, {
          method: "POST",
          signal: withTimeout(signal, timeout),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "pi-scrape-extension/1.0",
            ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
          },
          body: JSON.stringify({
            url: params.url,
            f: (params.onlyMainContent ?? true) ? "fit" : "raw",
            c: "0",
          }),
        });

        if (!response.ok) await throwHttpError("Crawl4AI", response);

        const document = await readJsonObject("Crawl4AI", response);
        const markdown =
          typeof document.markdown === "string" && document.markdown.trim()
            ? document.markdown.trim()
            : "No markdown content returned.";
        const metadata = params.includeMetadata
          ? `\n\nMetadata:\n${stringify({
              url: document.url ?? params.url,
              filter: document.filter,
              success: document.success,
              crawler: "Crawl4AI",
              crawler_url: baseUrl,
              waitFor_notice: params.waitFor
                ? "waitFor is accepted for compatibility but may be ignored by the Crawl4AI /md endpoint."
                : undefined,
            })}`
          : "";
        const output = formatToolOutput("scrape", `${markdown}${metadata}`);
        // A bounded preview lets the web presentation render the page without
        // shipping every byte of it through the session transcript twice.
        const PREVIEW_BYTES = 12 * 1024;
        const previewBytes = Buffer.from(markdown);
        const markdownPreview =
          previewBytes.byteLength > PREVIEW_BYTES
            ? `${previewBytes.subarray(0, PREVIEW_BYTES).toString("utf8")}\n\n[preview truncated — full page in the tool output]`
            : markdown;

        return {
          content: [{ type: "text", text: output.content }],
          details: scrapeCard({
            url: typeof document.url === "string" ? document.url : params.url,
            markdownLength: markdown.length,
            markdownPreview: markdownPreview,
            fullOutputPath: output.fullOutputPath,
          }),
        };
      } catch (error) {
        const message = redactSecrets(asErrorMessage(error));
        return {
          content: [
            {
              type: "text",
              text: `Crawl4AI scrape failed: ${message}`,
            },
          ],
          details: errorCard("Scrape failed", message),
          isError: true,
        };
      }
    },
  });
}
