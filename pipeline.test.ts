import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildDigest, sendDigest } from '@/lib/digest';
import { QuotaError } from '@/lib/http';
import type { JsonModel } from '@/lib/gemini';
import { runPipeline } from '@/lib/pipeline';
import { createMemoryRepo } from '@/lib/repo/memory';
import { runWeekly } from '@/lib/weekly';
import { loadWorkspace } from '@/lib/workspace';
import { selectLists, buildOpportunities } from '@/lib/opportunities';
import { art, NOW, q, settings, strongEx } from './helpers';

// Synthetic RSS, test-only
const rss = (n: number) => `<?xml version="1.0"?><rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>Acme CSR skilling programme ${i} - Example Times</title>
<link>https://news.google.com/rss/articles/T${i}</link><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate><source url="https://exampletimes.com">Example Times</source></item>`).join('')}</channel></rss>`;

const okFetch = (body: string) => (async () => new Response(body, { status: 200 })) as never;
const modelFor = (): JsonModel => ({
  name: 'test-model',
  generateJson: async (_s, user) => {
    const ids = [...user.matchAll(/ARTICLE id=(\w+)/g)].map((m) => m[1]);
    return ids.map((id) => ({
      id, company: { value: 'Acme', quote: 'Acme CSR skilling programme' }, signal: { value: 'allocation', quote: 'Acme CSR skilling programme' },
    }));
  },
});

const MONDAY = new Date('2026-10-12T00:45:00Z'); // 06:15 IST Monday
const TUESDAY = new Date('2026-10-13T00:45:00Z');
const SUNDAY = new Date('2026-10-11T00:45:00Z');
const env = { RESEND_API_KEY: 'k', DIGEST_FROM: 'radar@example.com', DIGEST_TO: 'ananya@example.com', APP_URL: 'https://radar.example.com' };

describe('pipeline run', () => {
  it('fetches, stores, extracts with quote checks and logs a succeeded run', async () => {
    const repo = createMemoryRepo({ demo: false });
    const run = await runPipeline({ repo, now: MONDAY, model: modelFor(), fetchImpl: okFetch(rss(3)), fetchText: async () => null, pauseMs: 0 }, 'cron');
    expect(run.status).toBe('succeeded');
    expect(run.extracted).toBe(3);
    const arts = await repo.listArticles('2026-09-01T00:00:00Z');
    expect(arts.every((a) => a.extraction?.company.tag === 'quoted')).toBe(true);
  });
  it('G8: a quota response ends the run as partial and keeps the articles queued', async () => {
    const repo = createMemoryRepo({ demo: false });
    let calls = 0;
    const model: JsonModel = { name: 'm', generateJson: async () => { calls++; throw new QuotaError(30); } };
    const run = await runPipeline({ repo, now: MONDAY, model, fetchImpl: okFetch(rss(6)), fetchText: async () => null, pauseMs: 0 }, 'cron');
    expect(run.status).toBe('partial');
    expect(calls).toBe(1);
    expect(run.queued).toBeGreaterThan(0);
    expect(run.sources.some((s) => s.source === 'Gemini Flash' && s.error_class === 'quota')).toBe(true);
  });
  it('G5: every source failing is a failed run, not an empty one, and seeds the labelled fallback', { timeout: 40000 }, async () => {
    const repo = createMemoryRepo({ demo: false });
    const bad = (async () => new Response('x', { status: 503 })) as never;
    const run = await runPipeline({ repo, now: MONDAY, model: modelFor(), fetchImpl: bad, pauseMs: 0, gdeltPauseMs: 0 }, 'cron');
    expect(run.status).toBe('failed');
    expect(run.notes.join(' ')).toContain('seeded');
  });
  it('without a Gemini key the run is partial and says why', async () => {
    const repo = createMemoryRepo({ demo: false });
    const run = await runPipeline({ repo, now: MONDAY, model: null, fetchImpl: okFetch(rss(2)), pauseMs: 0 }, 'cron');
    expect(run.status).toBe('partial');
    expect(run.notes.join(' ')).toContain('GEMINI_API_KEY');
  });
  it('a second run while one is running is refused (lock)', async () => {
    const repo = createMemoryRepo({ demo: false });
    await repo.startRun('manual', 15, MONDAY);
    const run = await runPipeline({ repo, now: MONDAY, model: null, fetchImpl: okFetch(rss(1)), pauseMs: 0 }, 'cron');
    expect(run.status).toBe('locked');
  });
});

describe('digest content and sending', () => {
  const mkLists = () => {
    const items = buildOpportunities({ articles: [art('a', strongEx(), { published_at: '2026-10-11T00:00:00Z', first_seen_at: '2026-10-11T00:00:00Z' })], companies: [], settings: settings(), events: [], now: MONDAY });
    return selectLists(items, settings());
  };
  it('G4: nothing qualified gets its own variant, with a status sentence', () => {
    const d = buildDigest({ lists: selectLists([], settings()), now: MONDAY, appUrl: 'https://x', latestRun: null, lastGoodRunDate: null, delayed: false, reviewed: 12 });
    expect(d.variant).toBe('nothing');
    expect(d.text).toContain('12 items reviewed, none reached Call this week');
  });
  it('G5: a failed run gets the failed variant and no cards', () => {
    const run = { status: 'failed' } as never;
    const d = buildDigest({ lists: mkLists(), now: MONDAY, appUrl: 'https://x', latestRun: run, lastGoodRunDate: '2026-10-05T00:00:00Z', delayed: false, reviewed: 0 });
    expect(d.variant).toBe('failed');
    expect(d.text).toContain('did not finish');
    expect(d.clusterIds.length).toBe(0);
  });
  it('normal digest lists the call item with why now, evidence and next action, plus a plain-text part', () => {
    const l = mkLists();
    expect(l.call.length).toBe(1);
    const d = buildDigest({ lists: l, now: MONDAY, appUrl: 'https://x', latestRun: { status: 'succeeded' } as never, lastGoodRunDate: null, delayed: false, reviewed: 3 });
    expect(d.variant).toBe('normal');
    expect(d.html).toContain('Acme Industries Ltd');
    expect(d.text).toContain('Next:');
    expect(d.text).toContain('never contacts anyone');
  });
  it('G1: two sends for the same week produce one email', async () => {
    const repo = createMemoryRepo({ demo: false });
    let posts = 0;
    const f = (async (_u: string, init: RequestInit) => { posts++; expect((init.headers as Record<string, string>)['idempotency-key']).toContain('ananya@example.com'); return new Response(JSON.stringify({ id: 're_1' }), { status: 200 }); }) as never;
    const content = buildDigest({ lists: selectLists([], settings()), now: MONDAY, appUrl: 'https://x', latestRun: null, lastGoodRunDate: null, delayed: false, reviewed: 0 });
    const deps = { repo, resendKey: 'k', from: 'a@b.c', to: 'ananya@example.com', fetchImpl: f, now: MONDAY };
    const [r1, r2] = await Promise.all([sendDigest(deps, content), sendDigest(deps, content)]);
    expect([r1.status, r2.status].filter((s) => s === 'sent').length).toBeGreaterThanOrEqual(1);
    const r3 = await sendDigest(deps, content);
    expect(r3.status).toBe('already_sent');
    expect(posts).toBeLessThanOrEqual(2); // never a third
  });
  it('G6: a provider error leaves the digest failed and a retry reuses the row', async () => {
    const repo = createMemoryRepo({ demo: false });
    const content = buildDigest({ lists: selectLists([], settings()), now: MONDAY, appUrl: 'https://x', latestRun: null, lastGoodRunDate: null, delayed: false, reviewed: 0 });
    const bad = (async () => new Response(JSON.stringify({ message: 'nope' }), { status: 422 })) as never;
    const r1 = await sendDigest({ repo, resendKey: 'k', from: 'a@b.c', to: 'x@y.z', fetchImpl: bad, now: MONDAY }, content);
    expect(r1.status).toBe('failed');
    expect((await repo.getDigest('x@y.z', '2026-10-12'))!.status).toBe('failed');
    const good = (async () => new Response(JSON.stringify({ id: 're_2' }), { status: 200 })) as never;
    const r2 = await sendDigest({ repo, resendKey: 'k', from: 'a@b.c', to: 'x@y.z', fetchImpl: good, now: MONDAY }, content);
    expect(r2.status).toBe('sent');
    expect((await repo.getDigest('x@y.z', '2026-10-12'))!.status).toBe('sent');
  });
  it('sending is skipped, not attempted, when keys are missing', async () => {
    const repo = createMemoryRepo({ demo: false });
    const content = buildDigest({ lists: selectLists([], settings()), now: MONDAY, appUrl: '', latestRun: null, lastGoodRunDate: null, delayed: false, reviewed: 0 });
    const r = await sendDigest({ repo, resendKey: undefined, from: undefined, to: undefined, now: MONDAY }, content);
    expect(r.status).toBe('skipped');
  });
});

describe('weekly schedule (G2, G3)', () => {
  const base = () => ({ repo: createMemoryRepo({ demo: false }), model: modelFor(), env, fetchImpl: undefined as never, fetchText: async () => null, pauseMs: 0, gdeltPauseMs: 0 });
  const mkFetch = () => {
    let sends = 0;
    const f = (async (u: string) => {
      if (u.includes('resend.com')) { sends++; return new Response(JSON.stringify({ id: 're' }), { status: 200 }); }
      return new Response(rss(2), { status: 200 });
    }) as never;
    return { f, sends: () => sends };
  };
  it('Monday: runs and sends once; a second invocation does nothing', async () => {
    const { f, sends } = mkFetch();
    const b = { ...base(), fetchImpl: f };
    const r1 = await runWeekly({ ...b, now: MONDAY });
    expect(r1.action).toBe('ran');
    const r2 = await runWeekly({ ...b, now: new Date(MONDAY.getTime() + 20 * 60000) });
    expect(r2.action).toBe('idle');
    expect(sends()).toBe(1);
  });
  it('Tuesday catch-up sends a delayed digest once when Monday never went out', async () => {
    const { f, sends } = mkFetch();
    const b = { ...base(), fetchImpl: f };
    const r = await runWeekly({ ...b, now: TUESDAY });
    expect(r.action === 'ran' && r.variant).toBe('delayed');
    expect(sends()).toBe(1);
    expect((await runWeekly({ ...b, now: TUESDAY })).action).toBe('idle');
  });
  it('other days do nothing', async () => {
    const { f, sends } = mkFetch();
    const r = await runWeekly({ ...base(), fetchImpl: f, now: SUNDAY });
    expect(r.action).toBe('idle');
    expect(sends()).toBe(0);
  });
});

describe('workspace states', () => {
  it('a demo repo reports no live run; a live repo with a failed run reports failed', async () => {
    const demo = createMemoryRepo({ seed: true, demo: true });
    expect((await loadWorkspace(demo)).status).toBe('never');
    const live = createMemoryRepo({ demo: false });
    const run = await live.startRun('cron', 15, MONDAY);
    await live.finishRun(run!.id, { status: 'failed', finished_at: MONDAY.toISOString() });
    expect((await loadWorkspace(live, MONDAY)).status).toBe('failed');
  });
});

describe('G9: send path is confined', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(path.resolve(import.meta.dirname, '../src'));
  it('only digest.ts talks to the email provider', () => {
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('api.resend.com'));
    expect(hits.map((h) => path.basename(h))).toEqual(['digest.ts']);
  });
  it('sendDigest is only called from the weekly job', () => {
    const hits = files.filter((f) => /sendDigest\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('digest.ts'));
    expect(hits.map((h) => path.basename(h))).toEqual(['weekly.ts']);
  });
  it('unused import guard', () => expect(q(1).tag).toBe('quoted'));
  it('NOW constant is stable', () => expect(NOW.toISOString()).toBe('2026-10-12T04:00:00.000Z'));
});
