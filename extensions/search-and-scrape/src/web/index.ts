import SearchToolResult from "./SearchToolResult.svelte";
import ScrapeToolResult from "./ScrapeToolResult.svelte";

/**
 * Search & scrape's web presentation, paired with the Pi extension of the
 * same id: native cards for SearXNG result lists and Crawl4AI page grabs
 * instead of raw JSON dumps.
 */
export const gizmoWebExtension = {
  id: "search-and-scrape",
  labels: {
    search: "Search the web",
    scrape: "Scrape a page",
  },
  parametersFor: (name: string, parameters: [string, string][]) => {
    if (name === "search") {
      return parameters.filter(([param]) =>
        ["query", "limit", "source"].includes(param),
      );
    }
    if (name === "scrape") {
      return parameters.filter(([param]) =>
        ["url", "onlyMainContent", "waitFor", "timeout"].includes(param),
      );
    }
    return parameters;
  },
  resultFor: (name: string) => {
    if (name === "search") return SearchToolResult;
    if (name === "scrape") return ScrapeToolResult;
    return undefined;
  },
};
