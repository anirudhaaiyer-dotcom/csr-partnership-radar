import { fetchRetry, type FetchLike } from '../http';

/**
 * Google News gives a redirect link (news.google.com/rss/articles/<id>), not the publisher's page.
 * This turns it into the real article address so the full text can be read.
 * Step 1: older ids hold the address inside the id itself, so it is decoded locally.
 * Step 2: newer ids are looked up through Google's own page, using the signature that page carries.
 * Best effort: returns null when anything is different, and the caller then falls back to the headline.
 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function googleArticleId(link: string): string | null {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith('news.google.com')) return null;
    const m = u.pathname.match(/\/(?:rss\/)?(?:read|articles)\/([^/?]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Older Google News ids are base64 with the publisher address inside. Returns it, or null for the newer opaque ids. */
export function decodeLegacyId(id: string): string | null {
  try {
    const raw = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    if (raw.includes('AU_yqL')) return null; // opaque id: needs the lookup
    const m = raw.match(/https?:\/\/[\x21-\x7e]+/);
    if (!m) return null;
    const url = m[0].replace(/[\x00-\x1f].*$/, '');
    new URL(url);
    return url.includes('news.google.com') ? null : url;
  } catch {
    return null;
  }
}

/** Reads the publisher address out of Google's batchexecute answer. */
export function parseBatchAnswer(body: string): string | null {
  const m = body.match(/garturlres\\",\\"(https?:[^"\\]+)/);
  if (!m) return null;
  try {
    const url = JSON.parse(`"${m[1]}"`) as string;
    new URL(url);
    return url.includes('news.google.com') ? null : url;
  } catch {
    return null;
  }
}

export async function resolveGoogleLink(link: string, f: FetchLike = fetch): Promise<string | null> {
  const id = googleArticleId(link);
  if (!id) return null;
  const local = decodeLegacyId(id);
  if (local) return local;
  try {
    const page = await fetchRetry(`https://news.google.com/rss/articles/${id}?hl=en-IN&gl=IN&ceid=IN:en`, { headers: { 'user-agent': BROWSER_UA }, redirect: 'follow', timeoutMs: 6000, retries: 0 }, f);
    if (!page.ok) return null;
    const final = page.url ? new URL(page.url) : null;
    if (final && !final.hostname.endsWith('google.com')) return final.toString();
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
    const res = await fetchRetry('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': BROWSER_UA },
      body, timeoutMs: 6000, retries: 0,
    }, f);
    if (!res.ok) return null;
    return parseBatchAnswer(await res.text());
  } catch {
    return null;
  }
}
