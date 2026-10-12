import { createHash } from 'node:crypto';
import type { SourceClass } from './types';
import { BLOG_PLATFORMS, MAJOR_PRESS, OFFICIAL_WIRES } from './config';

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$|cmpid|igshid|ocid|oc$)/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let p = u.pathname.replace(/\/+$/, '');
    if (p === '') p = '';
    return `${u.protocol}//${u.hostname}${p}${u.search}`;
  } catch {
    return raw.trim();
  }
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|pvt|private|inc|incorporated|corp|corporation|co|company|llp|plc)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** For quote checking: lower case, straight quotes, collapsed whitespace and dashes. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const q = normalizeText(quote);
  if (q.length < 8) return false;
  return normalizeText(text).includes(q);
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'by', 'at', 'from', 'its', 'is', 'as', 'rs', 'crore', 'csr']);
export function titleTokens(t: string): Set<string> {
  return new Set(
    normalizeText(t)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function classifySource(domain: string | null, companyKey?: string | null): SourceClass {
  if (!domain) return 'regional_trade';
  const d = domain.toLowerCase();
  if (BLOG_PLATFORMS.some((b) => d === b || d.endsWith('.' + b))) return 'blog';
  if (MAJOR_PRESS.some((m) => d === m || d.endsWith('.' + m))) return 'major_press';
  if (OFFICIAL_WIRES.some((w) => d === w || d.endsWith('.' + w) || d.startsWith(w))) return 'official';
  if (companyKey) {
    const compact = companyKey.replace(/ /g, '');
    const dc = d.replace(/[^a-z0-9]/g, '');
    if (compact.length >= 4 && dc.includes(compact)) return 'official';
  }
  return 'regional_trade';
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
