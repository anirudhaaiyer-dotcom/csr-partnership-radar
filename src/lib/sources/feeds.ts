import { XMLParser } from 'fast-xml-parser';
import { fetchRetry, SourceError, type FetchLike } from '../http';
import { domainOf, stripTags } from '../util';
import type { Company, Settings, SourceStat } from '../types';

export interface RawItem {
  url: string;
  title: string;
  publisher: string | null;
  publisher_domain: string | null;
  published_at: string | null;
  snippet: string;
  source: 'google_news' | 'gdelt';
}

const UA = 'CSRPartnershipRadar/0.1 (weekly CSR digest for an Indian education NGO)';

export function buildQueries(settings: Settings, companies: Company[]): string[] {
  const watch = companies.filter((c) => c.relationship).slice(0, 8).map((c) => `"${c.name}" CSR education OR skilling OR youth`);
  return [...settings.queries, ...watch];
}

/** `when:` is a community-documented operator, not an official one. Dates are re-checked client-side anyway. */
export const googleFeedUrl = (q: string, days = 21) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-IN&gl=IN&ceid=IN:en`;

export function parseGoogleRss(xml: string): RawItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((it: Record<string, unknown>): RawItem | null => {
      const link = typeof it.link === 'string' ? it.link : '';
      let title = typeof it.title === 'string' ? it.title : '';
      const src = it.source as { '#text'?: string; '@_url'?: string } | string | undefined;
      const publisher = typeof src === 'string' ? src : src?.['#text'] ?? null;
      const pubUrl = typeof src === 'object' ? src?.['@_url'] ?? null : null;
      if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
      if (!link || !title) return null;
      const d = typeof it.pubDate === 'string' ? new Date(it.pubDate) : null;
      const desc = stripTags(typeof it.description === 'string' ? it.description : '');
      const snippet = desc && desc !== title && !desc.startsWith(title) ? desc : '';
      return {
        url: link, title: title.trim(), publisher, publisher_domain: pubUrl ? domainOf(pubUrl) : null,
        published_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null, snippet, source: 'google_news',
      };
    })
    .filter((x: RawItem | null): x is RawItem => x !== null);
}

export const gdeltUrl = (q: string, days = 21) =>
  `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=${days}d`;

function gdeltDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

export function parseGdelt(text: string): RawItem[] {
  let json: { articles?: { url: string; title: string; seendate?: string; domain?: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceError('parse', 'GDELT did not return JSON');
  }
  return (json.articles ?? [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      url: a.url, title: a.title.trim(), publisher: a.domain ?? null, publisher_domain: a.domain ?? domainOf(a.url),
      published_at: gdeltDate(a.seendate), snippet: '', source: 'gdelt' as const,
    }));
}

export interface FeedResult {
  items: RawItem[];
  stat: SourceStat;
}

/** One query at a time with a short pause, so a run stays polite and predictable. */
export async function fetchGoogleNews(queries: string[], f: FetchLike = fetch, pauseMs = 400): Promise<FeedResult> {
  const items: RawItem[] = [];
  let failures = 0;
  let lastClass: string | null = null;
  let lastDetail = '';
  for (const q of queries) {
    try {
      const res = await fetchRetry(googleFeedUrl(q), { headers: { 'user-agent': UA }, timeoutMs: 10000, retries: 1 }, f);
      if (!res.ok) throw new SourceError(`http_${res.status}`, `HTTP ${res.status}`);
      items.push(...parseGoogleRss(await res.text()));
    } catch (e) {
      failures++;
      lastClass = e instanceof SourceError ? e.errorClass : 'unknown';
      lastDetail = (e as Error).message;
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  const ok = failures < queries.length;
  return {
    items,
    stat: {
      source: 'Google News RSS', ok, items: items.length,
      error_class: failures ? lastClass : null,
      detail: failures ? `${failures} of ${queries.length} queries failed. Last: ${lastDetail}` : `${queries.length} queries`,
    },
  };
}

export async function fetchGdelt(queries: string[], f: FetchLike = fetch, pauseMs = 5200): Promise<FeedResult> {
  const items: RawItem[] = [];
  let failures = 0;
  let lastClass: string | null = null;
  let lastDetail = '';
  for (const q of queries) {
    try {
      const res = await fetchRetry(gdeltUrl(q), { headers: { 'user-agent': UA }, timeoutMs: 12000, retries: 1 }, f);
      if (!res.ok) throw new SourceError(`http_${res.status}`, `HTTP ${res.status}`);
      items.push(...parseGdelt(await res.text()));
    } catch (e) {
      failures++;
      lastClass = e instanceof SourceError ? e.errorClass : 'unknown';
      lastDetail = (e as Error).message;
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs)); // GDELT asks for roughly one request per five seconds
  }
  return {
    items,
    stat: {
      source: 'GDELT', ok: failures < queries.length, items: items.length,
      error_class: failures ? lastClass : null,
      detail: failures ? `${failures} of ${queries.length} queries failed. Last: ${lastDetail}` : `${queries.length} queries`,
    },
  };
}

/** GDELT queries derived from the same settings. Syntax is untested here; the first run records the outcome. */
export const gdeltQueries = (settings: Settings) => settings.queries.slice(0, 3).map((q) => `${q} sourcecountry:IN`);
