/**
 * Search Tool Adapter — Real Web Search
 *
 * Performs live web searches using configurable endpoints.
 * Primary: DuckDuckGo HTML scraping / Instant Answers
 * Fallback: Configurable external search API (SerpAPI, Bing, etc.)
 */

import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface SearchInputs {
  query: string;
  filters?: {
    region?: string;
    safeSearch?: boolean;
    maxResults?: number;
    timeRange?: string; // e.g. "d", "w", "m", "y"
  };
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
  timestamp?: string;
}

const SEARCH_TIMEOUT = 15000;

/**
 * Execute a real web search.
 */
export async function executeSearch(
  inputs: SearchInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = ["external_communication"];

  try {
    const query = (inputs.query || "").trim();
    if (!query) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Search tool requires a 'query' string",
        "search"
      );
    }

    const maxResults = Math.min(inputs.filters?.maxResults ?? 10, 50);
    const results: SearchResult[] = [];

    // Try configured search API first
    const configuredUrl = process.env.SEARCH_API_URL;
    const apiKey = process.env.SEARCH_API_KEY;

    if (configuredUrl && apiKey) {
      const apiResults = await searchViaApi(configuredUrl, apiKey, query, maxResults, inputs.filters);
      results.push(...apiResults);
    }

    // Fallback to DuckDuckGo Instant Answers
    if (results.length === 0) {
      const ddgResults = await searchDuckDuckGo(query, maxResults, inputs.filters);
      results.push(...ddgResults);
    }

    // If still no results, try DuckDuckGo HTML
    if (results.length === 0) {
      const htmlResults = await searchDuckDuckGoHTML(query, maxResults);
      results.push(...htmlResults);
    }

    return {
      success: true,
      output: {
        results,
        total: results.length,
        query,
        filters: inputs.filters ?? {},
      },
      duration: Date.now() - start,
      sideEffects,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configured Search API
// ─────────────────────────────────────────────────────────────────────────────

async function searchViaApi(
  endpoint: string,
  apiKey: string,
  query: string,
  maxResults: number,
  filters?: SearchInputs["filters"]
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(maxResults));
    if (filters?.region) url.searchParams.set("gl", filters.region);
    if (filters?.timeRange) url.searchParams.set("tbs", `qdr:${filters.timeRange}`);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Search API HTTP ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Handle common response formats (SerpAPI, Bing-like, generic)
    if (Array.isArray(data.results)) {
      return (data.results as Array<Record<string, unknown>>).map((r) => ({
        title: String(r.title ?? r.name ?? "Untitled"),
        snippet: String(r.snippet ?? r.description ?? r.abstract ?? ""),
        url: String(r.link ?? r.url ?? r.href ?? ""),
        source: String(r.source ?? r.displayed_link ?? r.domain ?? "web"),
      }));
    }

    if (Array.isArray(data.organic_results)) {
      return (data.organic_results as Array<Record<string, unknown>>).map((r) => ({
        title: String(r.title ?? "Untitled"),
        snippet: String(r.snippet ?? r.description ?? ""),
        url: String(r.link ?? r.url ?? ""),
        source: String(r.displayed_link ?? r.source ?? "web"),
      }));
    }

    return [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DuckDuckGo Instant Answers API
// ─────────────────────────────────────────────────────────────────────────────

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  _filters?: SearchInputs["filters"]
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    // DuckDuckGo Instant Answers API (limited to ~1 result but real)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, unknown>;
    const results: SearchResult[] = [];

    const abstractText = data.AbstractText as string | undefined;
    const abstractURL = data.AbstractURL as string | undefined;
    const abstractSource = data.AbstractSource as string | undefined;

    if (abstractText && abstractURL) {
      results.push({
        title: abstractSource || "DuckDuckGo Instant Answer",
        snippet: abstractText,
        url: abstractURL,
        source: abstractSource || "DuckDuckGo",
      });
    }

    // Related topics
    const relatedTopics = (data.RelatedTopics as Array<Record<string, unknown>>) ?? [];
    for (const topic of relatedTopics.slice(0, maxResults - 1)) {
      const text = topic.Text as string | undefined;
      const firstURL = topic.FirstURL as string | undefined;
      if (text && firstURL) {
        results.push({
          title: text.split(" - ")[0] || text.slice(0, 60),
          snippet: text,
          url: firstURL,
          source: "DuckDuckGo",
        });
      }
    }

    return results;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DuckDuckGo HTML scraping (fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function searchDuckDuckGoHTML(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    // DuckDuckGo Lite HTML for scraping
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    return parseDuckDuckGoHTML(html, maxResults);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

function parseDuckDuckGoHTML(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo Lite results are in table rows with class "result-link" or similar patterns
  // Match result links and their surrounding snippets
  const resultRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>(.*?)<\/td>/gi;

  let linkMatch: RegExpExecArray | null;
  let snippetMatch: RegExpExecArray | null;

  const links: { url: string; title: string }[] = [];
  const snippets: string[] = [];

  while ((linkMatch = resultRegex.exec(html)) !== null) {
    links.push({
      url: decodeHTMLEntities(linkMatch[1]),
      title: stripHtml(decodeHTMLEntities(linkMatch[2])),
    });
  }

  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(decodeHTMLEntities(snippetMatch[1])));
  }

  for (let i = 0; i < Math.min(links.length, snippets.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      snippet: snippets[i].slice(0, 300),
      url: links[i].url,
      source: extractDomain(links[i].url),
    });
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => entities[match] ?? match);
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}
