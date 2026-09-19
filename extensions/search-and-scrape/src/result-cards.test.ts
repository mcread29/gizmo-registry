import { describe, expect, it } from "vitest";
import { parseView } from "@gizmo/extension-api";
import { errorView, scrapeView, searchView } from "./result-cards.ts";

describe("result cards", () => {
  it("renders a search result list the host accepts", () => {
    const view = searchView({
      query: "typebox",
      numberOfResults: 2,
      searxngUrl: "http://127.0.0.1:8080",
      results: [
        {
          title: "TypeBox",
          url: "https://github.com/x/y",
          content: "JSON schema",
        },
        { url: "https://example.com/page" },
      ],
    });
    expect(parseView(view)).toBeDefined();
    const result = view.blocks[0];
    if (result.type !== "section") throw new Error("expected a result section");
    expect(result.title).toBe("TypeBox");
    expect(result.blocks[0]).toEqual({
      type: "link",
      text: "github.com",
      url: "https://github.com/x/y",
    });
    expect(result.blocks[1]).toEqual({ type: "text", text: "JSON schema" });
    expect(JSON.stringify(view)).toContain("2 results");
  });

  it("marks an empty search as a warning", () => {
    const view = searchView({
      query: "nothing",
      numberOfResults: 0,
      results: [],
    });
    expect(view.status).toBe("warning");
    expect(parseView(view)).toBeDefined();
  });

  it("renders a scrape preview with its size and file", () => {
    const view = scrapeView({
      url: "https://example.com",
      markdownLength: 12_345,
      markdownPreview: "# Title\n\nBody",
      fullOutputPath: "/tmp/scrape.md",
    });
    expect(parseView(view)).toBeDefined();
    expect(JSON.stringify(view)).toContain("12,345 chars");
    expect(JSON.stringify(view)).toContain("/tmp/scrape.md");
  });

  it("clips an over-long preview and title", () => {
    const view = scrapeView({
      url: `https://example.com/${"a".repeat(600)}`,
      markdownLength: 40_000,
      markdownPreview: "x".repeat(9_000),
    });
    expect(view.title.length).toBeLessThanOrEqual(500);
    expect(parseView(view)).toBeDefined();
    expect(JSON.stringify(view)).toContain("preview truncated");
  });

  it("renders an error card", () => {
    const view = errorView("Scrape failed", "connection refused");
    expect(view.status).toBe("error");
    expect(parseView(view)).toBeDefined();
  });
});
