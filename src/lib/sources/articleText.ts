import { fetchRetry, type FetchLike } from '../http';
import { stripTags } from '../util';

const UA = 'CSRPartnershipRadar/0.1 (weekly CSR digest for an Indian education NGO)';
const MAX_BYTES = 600_000;
const MAX_CHARS = 8000;

/** Minimal robots.txt reader: honours Disallow lines under `User-agent: *`. */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let any = false;
  const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      applies = v === '*';
      any = any || applies;
    } else if (applies && k === 'disallow' && v) rules.push(v);
  }
  if (!any) return true;
  return !rules.some((r) => path.startsWith(r.replace(/\*$/, '')));
}

export function extractBodyText(html: string): string {
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paras = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1])).filter((p) => p.length > 40);
  return paras.join('\n').slice(0, MAX_CHARS);
}

const robotsCache = new Map<string, string | null>();

/** Best-effort article text. Returns null when blocked, not HTML, or when the link only leads back to Google. */
export async function fetchArticleText(url: string, f: FetchLike = fetch): Promise<string | null> {
  try {
    const first = new URL(url);
    if (first.hostname.endsWith('google.com')) {
      const res = await fetchRetry(url, { headers: { 'user-agent': UA }, redirect: 'follow', timeoutMs: 6000, retries: 0 }, f);
      const final = new URL(res.url || url);
      if (final.hostname.endsWith('google.com')) return null;
      return readHtml(res);
    }
    const origin = first.origin;
    if (!robotsCache.has(origin)) {
      try {
        const r = await fetchRetry(`${origin}/robots.txt`, { headers: { 'user-agent': UA }, timeoutMs: 4000, retries: 0 }, f);
        robotsCache.set(origin, r.ok ? await r.text() : null);
      } catch {
        robotsCache.set(origin, null);
      }
    }
    const robots = robotsCache.get(origin);
    if (robots && !robotsAllows(robots, first.pathname)) return null;
    const res = await fetchRetry(url, { headers: { 'user-agent': UA }, redirect: 'follow', timeoutMs: 8000, retries: 0 }, f);
    return readHtml(res);
  } catch {
    return null;
  }
}

async function readHtml(res: Response): Promise<string | null> {
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html')) return null;
  const buf = (await res.text()).slice(0, MAX_BYTES);
  const text = extractBodyText(buf);
  return text.length > 200 ? text : null;
}
