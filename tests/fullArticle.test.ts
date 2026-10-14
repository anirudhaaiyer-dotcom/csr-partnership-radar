import { describe, expect, it } from 'vitest';
import type { JsonModel } from '@/lib/gemini';
import { runPipeline } from '@/lib/pipeline';
import { createMemoryRepo } from '@/lib/repo/memory';
import { decodeLegacyId, googleArticleId, parseBatchAnswer, resolveGoogleLink } from '@/lib/sources/googleLink';
import { fetchArticleText } from '@/lib/sources/articleText';
import { art, strongEx } from './helpers';

// Synthetic fixtures for tests only.
const OPAQUE = Buffer.from('\x08\x13"\x20AU_yqLopaqueidbody').toString('base64url');
const ANSWER = String.raw`)]}'

[["wrb.fr","Fbv4je","[\"garturlres\",\"https://www.example-times.com/csr/story-2\",1]",null,null,null,"generic"]]`;
const PARA = 'Acme Industries has opened a call for NGO partners to run skilling programmes for school dropouts in Pune this year.';
const PAGE = `<html><body><article>${`<p>${PARA}</p>`.repeat(4)}</article></body></html>`;

function fakeWeb(opts: { robots?: string; host?: string } = {}) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('https://news.google.com/rss/articles/')) return new Response('<div data-n-a-sg="SIG" data-n-a-ts="1700000000"></div>', { status: 200 });
    if (url.includes('batchexecute')) return new Response(opts.host ? ANSWER.replace('www.example-times.com', opts.host) : ANSWER, { status: 200 });
    if (url.endsWith('/robots.txt')) return opts.robots ? new Response(opts.robots, { status: 200 }) : new Response('', { status: 404 });
    return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as never;
  return { f, calls };
}

describe('Google News links are resolved to the real article', () => {
  it('reads the article id and decodes older ids locally', () => {
    expect(googleArticleId('https://news.google.com/rss/articles/ABC123?oc=5')).toBe('ABC123');
    expect(googleArticleId('https://example.com/rss/articles/ABC123')).toBeNull();
    const legacy = Buffer.from('\x08\x13"\x20https://www.example-times.com/csr/story-1\xd2\x01\x00').toString('base64url');
    expect(decodeLegacyId(legacy)).toBe('https://www.example-times.com/csr/story-1');
    expect(decodeLegacyId(OPAQUE)).toBeNull();
  });
  it('reads the publisher address from the lookup answer and ignores anything else', () => {
    expect(parseBatchAnswer(ANSWER)).toBe('https://www.example-times.com/csr/story-2');
    expect(parseBatchAnswer('nothing useful')).toBeNull();
  });
  it('looks up an opaque id through the page signature', async () => {
    const { f, calls } = fakeWeb();
    expect(await resolveGoogleLink(`https://news.google.com/rss/articles/${OPAQUE}`, f)).toBe('https://www.example-times.com/csr/story-2');
    expect(calls.some((c) => c.startsWith('POST') && c.includes('batchexecute'))).toBe(true);
  });
  it('gives up quietly, never throws, when Google answers differently', async () => {
    const bad = (async () => new Response('<html>no signature</html>', { status: 200 })) as never;
    expect(await resolveGoogleLink(`https://news.google.com/rss/articles/${OPAQUE}`, bad)).toBeNull();
    const down = (async () => { throw new Error('offline'); }) as never;
    expect(await resolveGoogleLink(`https://news.google.com/rss/articles/${OPAQUE}`, down)).toBeNull();
  });
  it('reads the whole article behind a Google link, and still honours robots.txt', async () => {
    const link = `https://news.google.com/rss/articles/${OPAQUE}`;
    const ok = await fetchArticleText(link, fakeWeb().f);
    expect(ok).toContain('call for NGO partners');
    expect(ok!.length).toBeGreaterThan(300);
    expect(await fetchArticleText(link, fakeWeb({ host: 'www.blocked-example.com', robots: 'User-agent: *\nDisallow: /csr/' }).f)).toBeNull();
  });
});

describe('earlier headline-only items are re-read on the full article, then re-scored', () => {
  const NOW = new Date('2026-10-12T00:45:00Z');
  const rss = `<?xml version="1.0"?><rss><channel></channel></rss>`;
  const model: JsonModel = {
    name: 'test-model',
    generateJson: async (_s, user) => [...user.matchAll(/ARTICLE id=(\w+)/g)].map((m) => ({
      id: m[1], company: { value: 'Acme', quote: 'Acme CSR skilling programme' }, signal: { value: 'allocation', quote: 'Acme CSR skilling programme' },
    })),
  };
  async function seeded() {
    const repo = createMemoryRepo({ demo: false });
    const a = art('u1', strongEx(), { source: 'google_news', title: 'Acme CSR skilling programme upgrade', text: 'Acme CSR skilling programme upgrade', text_kind: 'snippet_only', url: 'https://news.example.com/u1', published_at: '2026-10-11T00:00:00Z' });
    await repo.insertNewArticles([a]);
    await repo.saveExtraction(a.id, a.extraction, 1);
    return { repo, id: a.id };
  }
  const base = { now: NOW, model, fetchImpl: (async () => new Response(rss, { status: 200 })) as never, pauseMs: 0, gdeltPauseMs: 0 };

  it('uses the full page when it can be read', async () => {
    const { repo, id } = await seeded();
    const run = await runPipeline({ ...base, repo, fetchText: async () => 'Acme CSR skilling programme expands. ' + PARA.repeat(3) }, 'cron');
    const a = (await repo.listArticles('2026-09-01T00:00:00Z')).find((x) => x.id === id)!;
    expect(a.text_kind).toBe('body');
    expect(a.extraction?.signal.value).toBe('allocation');
    expect(a.extraction_attempts).toBe(2);
    expect(run.notes.join(' ')).toContain('re-read on the full article');
  });
  it('keeps the first result, and tries only once, when the page cannot be read', async () => {
    const { repo, id } = await seeded();
    await runPipeline({ ...base, repo, fetchText: async () => null }, 'cron');
    const a = (await repo.listArticles('2026-09-01T00:00:00Z')).find((x) => x.id === id)!;
    expect(a.text_kind).toBe('snippet_only');
    expect(a.extraction?.signal.value).toBe('partner_search');
    expect(a.extraction_attempts).toBe(2);
  });
});
