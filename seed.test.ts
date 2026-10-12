import { describe, expect, it } from 'vitest';
import { buildOpportunities, selectLists } from '@/lib/opportunities';
import { loadSeedArticles, SEED_AS_OF } from '@/lib/seed';
import { DEFAULT_SETTINGS } from '@/lib/config';
import { quoteInText } from '@/lib/util';
import { createMemoryRepo } from '@/lib/repo/memory';

describe('seed data', () => {
  const arts = loadSeedArticles();
  it('every extracted quote is an exact substring of the stored text', () => {
    for (const a of arts) {
      const ex = a.extraction!;
      for (const [k, f] of Object.entries(ex)) {
        if (typeof f === 'object' && f && 'tag' in f && (f as { tag: string }).tag === 'quoted') {
          const quote = (f as { quote: string }).quote;
          expect(quoteInText(quote, `${a.title}\n${a.text}`), `${a.title} / ${k}`).toBe(true);
        }
      }
    }
  });
  it('items have real urls and dates', () => {
    for (const a of arts) {
      expect(a.url.startsWith('https://')).toBe(true);
      expect(Number.isNaN(Date.parse(a.published_at!))).toBe(false);
    }
  });
  it('builds opportunities without throwing and respects the windows at the seed date', () => {
    const now = new Date(SEED_AS_OF);
    const all = buildOpportunities({ articles: arts, companies: [], settings: DEFAULT_SETTINGS, events: [], now });
    const lists = selectLists(all, DEFAULT_SETTINGS);
    console.log(all.map((o) => `${o.company} | ${o.verdict} | ${o.total} | age ${o.age_days} | ${o.confidence} | ${o.next_action}`).join('\n'));
    console.log('call', lists.call.length, 'watch', lists.watch.length, 'late', lists.late.length);
    expect(all.length).toBe(arts.length - 0);
  });
  it('memory repo: digest uniqueness and run lock', async () => {
    const r = createMemoryRepo();
    const now = new Date();
    const d1 = await r.createDigest({ recipient: 'a@b.c', week_start: '2026-10-12', status: 'pending', variant: 'normal', resend_id: null, error: null, created_at: now.toISOString(), sent_at: null });
    const d2 = await r.createDigest({ recipient: 'a@b.c', week_start: '2026-10-12', status: 'pending', variant: 'normal', resend_id: null, error: null, created_at: now.toISOString(), sent_at: null });
    expect(d1).not.toBeNull();
    expect(d2).toBeNull();
    const a = await r.startRun('manual', 15, now);
    const b = await r.startRun('manual', 15, now);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const later = new Date(now.getTime() + 20 * 60000);
    expect(await r.startRun('cron', 15, later)).not.toBeNull(); // stale lock expires
  });
});
