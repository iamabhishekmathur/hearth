import { env } from '../config.js';
import { logger } from '../lib/logger.js';

// ── Types ──

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  contentType: string;
  bytesFetched: number;
}

// ── Constants ──

const USER_AGENT =
  'Mozilla/5.0 (compatible; HearthBot/1.0; +https://github.com/anthropics/hearth)';
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_LENGTH = 30_000;

// ── Web Search ──

/**
 * Search the web for information.
 * Uses Brave Search API if BRAVE_SEARCH_API_KEY is set, otherwise falls back
 * to scraping DuckDuckGo HTML search results.
 */
export async function webSearch(
  query: string,
  options?: { maxResults?: number },
): Promise<SearchResult[]> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

  try {
    if (env.BRAVE_SEARCH_API_KEY) {
      return await braveSearch(query, maxResults);
    }
    return await duckDuckGoSearch(query, maxResults);
  } catch (err) {
    logger.error({ err, query }, 'Web search failed');
    return [];
  }
}

async function braveSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY!,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, 'Brave Search API error');
    return [];
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  const results = data.web?.results ?? [];
  return results.slice(0, maxResults).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.error({ status: response.status }, 'DuckDuckGo search failed');
    return [];
  }

  const html = await response.text();
  return parseDuckDuckGoResults(html, maxResults);
}

function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results are in <a class="result__a"> for title/url
  // and <a class="result__snippet"> for the snippet
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // Extract URL and title from result__a link
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let resultUrl = titleMatch[1];
    const titleHtml = titleMatch[2];

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      resultUrl = decodeURIComponent(uddgMatch[1]);
    }

    // Strip HTML tags from title
    const title = titleHtml.replace(/<[^>]+>/g, '').trim();

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return results;
}

// ── Web Fetch ──

/**
 * Fetch a URL and extract readable text content.
 * Strips HTML tags and extracts the main text for HTML pages.
 * Returns formatted JSON for JSON responses, and plain text as-is.
 */
export async function webFetch(
  url: string,
  options?: { maxLength?: number },
): Promise<FetchResult> {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const rawContentType = response.headers.get('content-type') ?? 'text/plain';
  const contentType = rawContentType.split(';')[0].trim();
  const rawBody = await response.text();
  const bytesFetched = new TextEncoder().encode(rawBody).length;

  let title = '';
  let content: string;

  if (contentType.includes('json')) {
    // JSON: pretty-print
    try {
      const parsed = JSON.parse(rawBody);
      content = JSON.stringify(parsed, null, 2);
    } catch {
      content = rawBody;
    }
  } else if (contentType.includes('html')) {
    // HTML: extract readable text
    title = extractTitle(rawBody);
    content = extractReadableText(rawBody);
  } else {
    // Plain text or other: return as-is
    content = rawBody;
  }

  // Truncate to max length
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + '\n\n[Content truncated at ' + maxLength + ' characters]';
  }

  return { url, title, content, contentType, bytesFetched };
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function extractReadableText(html: string): string {
  let text = html;

  // Remove script blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Remove style blocks
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Remove nav blocks
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');

  // Remove footer blocks
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Remove header blocks
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

  // Replace block-level elements with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?(p|div|li|tr|h[1-6]|blockquote|section|article)[^>]*>/gi, '\n');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Collapse whitespace: multiple spaces/tabs to single space
  text = text.replace(/[ \t]+/g, ' ');

  // Collapse multiple newlines to at most two
  text = text.replace(/\n[ \t]*\n/g, '\n\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
