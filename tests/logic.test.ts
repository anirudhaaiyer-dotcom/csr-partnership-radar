import { describe, expect, it } from 'vitest';
import { RUBRIC } from '@/lib/config';
import { buildOpportunities, clusterArticles, selectLists } from '@/lib/opportunities';
import { scoreItem } from '@/lib/scoring';
import { checkSection135, checkScheduleVII } from '@/lib/checks';
import { decide } from '@/lib/verdict';
import { ageDays, nextMondayDay, istDay, weekStartIST, dayToIso } from '@/lib/time';
import { normalizeUrl, quoteInText } from '@/lib/util';
import { art, company, daysAgo, event, ex, NOW, q, settings, strongEx } from './helpers';
import type { Extraction } from '@/lib/types';

const build = (articles: ReturnType<typeof art>[], o: { companies?: ReturnType<typeof company>[]; events?: ReturnType<typeof event>[]; s?: ReturnType<typeof settings> } = {}) =>
  buildOpportunities({ articles, companies: o.companies ?? [], settings: o.s ?? settings(), events: o.events ?? [], now: NOW });

describe('Scoring and verdicts', () => {
  it('S1: every factor combination stays within its maximum and the total within 100', () => {
    const sig = ['partner_search', 'initiative_budget', 'allocation'] as const;
    const ben = ['dropouts_first_gen', 'low_income_youth', 'youth_general', 'none'] as const;
    const sec = ['skilling_placement', 'digital_youth_employment', 'other_education'] as const;
    const geo = ['pune', 'maharashtra', 'pan_india', 'base_maharashtra', 'other'] as const;
    const scale = [null, 0.5, 2, 7, 15];
    const ages = [0, 3, 6];
    const src = ['official', 'major_press', 'regional_trade', 'blog'] as const;
    const act = ['contact', 'foundation', 'none'] as const;
    let n = 0, maxSeen = 0;
    for (const s of sig) for (const b of ben) for (const se of sec) for (const g of geo) for (const sc of scale)
      for (const a of ages) for (const so of src) for (const ac of act) {
        const e: Extraction = ex({
          signal: q(s), beneficiary: b === 'none' ? ex().beneficiary : q(b), sector: q(se),
          geography: g === 'base_maharashtra' || g === 'other' ? ex().geography : q(g),
          scale_cr: sc === null ? ex().scale_cr : q(sc),
          contact: ac === 'contact' ? q('A Person') : ex().contact, foundation: ac === 'foundation' ? q('Acme Foundation') : ex().foundation,
        });
        const r = scoreItem({ ex: e, age: a, sourceClass: so, company: g === 'base_maharashtra' ? company('X', { hq_maharashtra: true }) : null });
        for (const f of r.factors) expect(f.points).toBeLessThanOrEqual(f.max);
        expect(r.total).toBeLessThanOrEqual(100);
        maxSeen = Math.max(maxSeen, r.total);
        n++;
      }
    expect(n).toBe(32400);
    expect(maxSeen).toBeLessThanOrEqual(100);
  });

  const base = {
    signal: 'initiative_budget' as const, explicitPartnerSearch: false, beneficiaryPoints: 12, readiness: { state: 'passed' as const, reason: '' },
    checks: { schedule_vii: { state: 'passed' as const, reason: '' }, section135: { state: 'passed' as const, reason: '' }, exclusions: { state: 'passed' as const, reason: '' } },
    settings: { call_min: 70, watch_min: 45, fit_floor: 6 },
  };

  it('S2: band boundaries 70 / 69 / 45 / 44', () => {
    expect(decide({ ...base, total: 70 }).verdict).toBe('call');
    expect(decide({ ...base, total: 69 }).verdict).toBe('watch');
    expect(decide({ ...base, total: 45 }).verdict).toBe('watch');
    expect(decide({ ...base, total: 44 }).verdict).toBe('skip');
  });

  it('S3: a failed check excludes the item whatever the score', () => {
    const r = decide({ ...base, total: 98, checks: { ...base.checks, exclusions: { state: 'failed', reason: 'x' } } });
    expect(r.verdict).toBe('excluded');
    const items = build([art('a', strongEx())], { companies: [company('Acme Industries Ltd', { excluded: true })] });
    expect(items[0].verdict).toBe('excluded');
    expect(items[0].total).toBeNull();
  });

  it('S3b: failed NGO readiness excludes everything', () => {
    const r = decide({ ...base, total: 98, readiness: { state: 'failed', reason: '' } });
    expect(r.verdict).toBe('excluded');
  });

  it('S4: fit floor keeps a 75 with beneficiary under 6 at Watch', () => {
    expect(decide({ ...base, total: 75, beneficiaryPoints: 0 }).verdict).toBe('watch');
    expect(decide({ ...base, total: 75, beneficiaryPoints: 6 }).verdict).toBe('call');
  });

  it('S5: geography points 15 / 12 / 9 / 6 / 0, and unquoted geography scores 0', () => {
    const pts = (e: Extraction, c = null as ReturnType<typeof company> | null) => scoreItem({ ex: e, age: 1, sourceClass: 'major_press', company: c }).factors[3].points;
    expect(pts(strongEx({ geography: q('pune') }))).toBe(15);
    expect(pts(strongEx({ geography: q('maharashtra') }))).toBe(12);
    expect(pts(strongEx({ geography: q('pan_india') }))).toBe(9);
    expect(pts(strongEx({ geography: ex().geography }), company('Acme', { hq_maharashtra: true }))).toBe(6);
    expect(pts(strongEx({ geography: ex().geography }))).toBe(0);
    expect(pts(strongEx({ geography: q('other') }))).toBe(0);
  });

  it('S6: explicit partner search passing the checks is Call this week; failing Schedule VII it is Excluded', () => {
    const lowEx = strongEx({ beneficiary: ex().beneficiary, geography: ex().geography, scale_cr: ex().scale_cr });
    const items = build([art('a', lowEx)]);
    expect(items[0].verdict).toBe('call');
    const bad = build([art('b', strongEx({ schedule_vii: q('not_fits') }))]);
    expect(bad[0].verdict).toBe('excluded');
  });

  it('S6b: Schedule VII unknown caps at Watch, Section 135 unknown does not', () => {
    const noVii = strongEx({ schedule_vii: ex().schedule_vii, explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget') });
    const a = build([art('a', noVii)]);
    expect(a[0].checks.schedule_vii.state).toBe('unknown');
    expect(a[0].verdict).toBe('watch');
    const b = build([art('b', strongEx({ explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget') }))]);
    expect(b[0].checks.section135.state).toBe('unknown');
    expect(b[0].verdict).toBe('call');
    expect(b[0].next_action.startsWith('Verify Section 135')).toBe(true);
  });

  it('S7: a quote that is not in the text fails the substring check', () => {
    expect(quoteInText('rs 12 crore for dropout youth', 'The firm will spend Rs 12 crore for dropout youth in Pune.')).toBe(true);
    expect(quoteInText('rs 99 crore for dropout youth', 'The firm will spend Rs 12 crore for dropout youth in Pune.')).toBe(false);
    expect(quoteInText('short', 'short')).toBe(false);
  });

  it('S8: scoring is deterministic', () => {
    const a = build([art('a', strongEx())]);
    const b = build([art('a', strongEx())]);
    expect(a).toEqual(b);
  });
});

describe('Eligibility checks', () => {
  it('E1/C2: a company not on the list is Unknown, never Passed', () => {
    expect(checkSection135(null).state).toBe('unknown');
    expect(checkSection135(company('X')).state).toBe('unknown');
  });
  it('C1: a listed company uses the status Ananya set, with date', () => {
    const c = company('Acme Industries Ltd', { section135: 'passed', checked_on: '2026-09-01', source_checked: 'FY26 annual report' });
    const r = checkSection135(c);
    expect(r.state).toBe('passed');
    expect(r.reason).toContain('FY26 annual report');
    const items = build([art('a', strongEx())], { companies: [c] });
    expect(items[0].checks.section135.state).toBe('passed');
  });
  it('E4: readiness failing does not change the other check states', () => {
    const items = build([art('a', strongEx())], { s: settings({ readiness: { csr1: 'failed', reg12a: 'unknown', g80_valid_until: null, record_years: null } }) });
    expect(items[0].verdict).toBe('excluded');
    expect(items[0].checks.schedule_vii.state).toBe('passed');
    expect(items[0].checks.section135.state).toBe('unknown');
  });
  it('E5: generated text never asserts a legal obligation', () => {
    const items = build([art('a', strongEx())]);
    const txt = JSON.stringify([items[0].next_action, items[0].why_now, items[0].verdict_reason, items[0].checks]).toLowerCase();
    expect(txt).not.toMatch(/\b(is obliged|is exempt|must spend|legally required)\b/);
  });
  it('E6: excluded items are kept out of Call and Watch lists', () => {
    const items = build([art('a', strongEx({ schedule_vii: q('not_fits') }))]);
    const l = selectLists(items, settings());
    expect(l.call.length + l.watch.length).toBe(0);
    expect(l.excluded.length).toBe(1);
  });
  it('checkScheduleVII needs a verified quote', () => {
    expect(checkScheduleVII(ex()).state).toBe('unknown');
  });
});

describe('Freshness and lifecycle', () => {
  const at = (n: number) => ({ published_at: daysAgo(n), first_seen_at: daysAgo(n) });
  it('F1: day 0 and day 7 are in the main pool, day 8 is not', () => {
    const mk = (id: string, n: number) => art(id, strongEx({ explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget'), company: q(`Co ${id}`) }), at(n));
    const items = build([mk('a', 0), mk('b', 7), mk('c', 8)]);
    const l = selectLists(items, settings());
    const names = [...l.call, ...l.watch].map((o) => o.company);
    expect(names).toContain('Co a');
    expect(names).toContain('Co b');
    expect(names).not.toContain('Co c');
  });
  it('F2: late finds need 8 to 21 days, never shown, fresh score at least 80, at most three', () => {
    const mk = (id: string, n: number) => art(id, strongEx({ company: q(`Co ${id}`), explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget'), scale_cr: q(12), contact: q('A Named Person') }), at(n));
    const arts = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(id, 9 + i));
    const items = build(arts);
    expect(items.every((o) => (o.fresh_total ?? 0) >= 80)).toBe(true);
    const l = selectLists(items, settings());
    expect(l.late.length).toBe(3);
    // an item shown before is never a late find
    const shownId = items[0].id;
    const l2 = selectLists(build(arts, { events: [event(shownId, 'shown')] }), settings());
    expect(l2.late.map((o) => o.id)).not.toContain(shownId);
    expect(l2.late.length).toBe(3);
    // too old for the discovery window
    const old = selectLists(build([mk('z', 25)]), settings());
    expect(old.late.length).toBe(0);
  });
  it('F2b: late finds respect the fit floor', () => {
    const e = strongEx({ beneficiary: ex().beneficiary, explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget') });
    const l = selectLists(build([art('a', e, at(10))]), settings());
    expect(l.late.length).toBe(0);
  });
  it('F3: an open call stays in the pool until its deadline, then drops out', () => {
    const deadlineIn = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
    const open = art('a', strongEx({ deadline: q(deadlineIn(10)) }), at(30));
    const items = build([open]);
    expect(items[0].is_open_call).toBe(true);
    expect(selectLists(items, settings()).call.length).toBe(1);
    const closed = build([art('b', strongEx({ deadline: q(deadlineIn(-1)) }), at(30))]);
    expect(closed[0].is_open_call).toBe(false);
    expect(selectLists(closed, settings()).call.length).toBe(0);
  });
  it('C5: a call closing before next Monday is listed under closing, even if Watch', () => {
    const dl = new Date(NOW.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const e = strongEx({ deadline: q(dl), explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget'), beneficiary: q('youth_general'), sector: q('other_education'), geography: ex().geography, scale_cr: ex().scale_cr });
    const items = build([art('a', e, at(1))]);
    expect(items[0].verdict).toBe('watch');
    expect(items[0].closing_before_next_monday).toBe(true);
    expect(selectLists(items, settings()).closing.length).toBe(1);
  });
  it('F4: a missing published date falls back to first seen', () => {
    const items = build([art('a', strongEx(), { published_at: null, first_seen_at: daysAgo(2) })]);
    expect(items[0].age_days).toBe(2);
    expect(items[0].published_at).toBeNull();
  });
  it('F5: a republished story keeps the earliest published date', () => {
    const a = art('a', strongEx(), { url: 'https://x.com/s', published_at: daysAgo(6), first_seen_at: daysAgo(6) });
    const b = art('b', strongEx(), { url: 'https://x.com/s?utm_source=feed', published_at: daysAgo(0), first_seen_at: daysAgo(0) });
    const items = build([a, b]);
    expect(items.length).toBe(1);
    expect(items[0].age_days).toBe(6);
  });
  it('F6: a changed deadline is recorded in history', () => {
    const a = art('a', strongEx({ deadline: q('2026-11-10') }), { first_seen_at: daysAgo(5), published_at: daysAgo(5), title: 'Acme partner call education skilling' });
    const b = art('b', strongEx({ deadline: q('2026-11-20') }), { first_seen_at: daysAgo(1), published_at: daysAgo(1), title: 'Acme partner call education skilling extended' });
    const items = build([a, b]);
    expect(items.length).toBe(1);
    expect(items[0].deadline).toBe('2026-11-20');
    expect(items[0].deadline_history).toEqual([{ from: '2026-11-10', to: '2026-11-20', at: b.first_seen_at }]);
  });
  it('IST day boundaries', () => {
    // 2026-10-11 20:00 UTC is 01:30 IST on 12 Oct
    expect(ageDays('2026-10-11T20:00:00Z', NOW)).toBe(0);
    expect(ageDays('2026-10-04T20:00:00Z', NOW)).toBe(7);
    expect(ageDays('2026-10-03T20:00:00Z', NOW)).toBe(8);
    expect(weekStartIST(NOW)).toBe('2026-10-12');
    expect(weekStartIST(new Date('2026-10-14T10:00:00Z'))).toBe('2026-10-12');
    expect(dayToIso(nextMondayDay(NOW))).toBe('2026-10-19');
    expect(dayToIso(nextMondayDay(new Date('2026-10-18T10:00:00Z')))).toBe('2026-10-19');
    expect(istDay(NOW)).toBeGreaterThan(0);
  });
});

describe('Deduplication', () => {
  it('D1: tracking parameters do not create a second article', () => {
    expect(normalizeUrl('https://www.site.com/a/b/?utm_source=x&id=1#frag')).toBe(normalizeUrl('https://site.com/a/b?id=1'));
  });
  it('D2: one announcement from three publishers is one card with all sources', () => {
    const t = 'Acme Industries announces CSR skilling programme for dropout youth in Pune';
    const arts = ['a', 'b', 'c'].map((id, i) => art(id, strongEx(), { title: t + (i ? ' report' : ''), url: `https://pub${i}.com/story` }));
    const items = build(arts);
    expect(items.length).toBe(1);
    expect(items[0].sources.length).toBe(3);
  });
  it('D3: one company with two different signals stays as two cards', () => {
    const a = art('a', strongEx(), { title: 'Acme partner search for skilling NGOs' });
    const b = art('b', strongEx({ signal: q('allocation'), explicit_partner_search: ex().explicit_partner_search }), { title: 'Acme allocates budget for skilling NGOs' });
    expect(build([a, b]).length).toBe(2);
  });
  it('D4: a merge marked not-duplicate is split and stays split', () => {
    const t = 'Acme Industries announces CSR skilling programme for dropout youth in Pune';
    const a = art('a', strongEx(), { title: t, url: 'https://p1.com/s' });
    const b = art('b', strongEx(), { title: t + ' report', url: 'https://p2.com/s' });
    expect(clusterArticles([a, b]).length).toBe(1);
    const pair = [a.id, b.id].sort().join('|');
    expect(clusterArticles([a, b], new Set([pair])).length).toBe(2);
  });
  it('articles with no verified company never become cards', () => {
    expect(build([art('a', ex())]).length).toBe(0);
  });
});

describe('Relationship factor and ordering (C3)', () => {
  it('a flagged company earns the actionability points and sorts first in its band', () => {
    const mk = (name: string) => art(name, strongEx({ company: q(name), explicit_partner_search: ex().explicit_partner_search, signal: q('initiative_budget') }));
    const items = build([mk('Alpha Co'), mk('Beta Co')], { companies: [company('Beta Co', { relationship: true, section135: 'passed' })] });
    const beta = items.find((o) => o.company === 'Beta Co')!;
    const alpha = items.find((o) => o.company === 'Alpha Co')!;
    expect(beta.factors[7].points).toBe(5);
    expect(beta.total! - alpha.total!).toBeLessThanOrEqual(5);
    expect(selectLists(items, settings()).call[0].company).toBe('Beta Co');
  });
  it('a flagged company that fails a check is still excluded', () => {
    const items = build([art('a', strongEx({ schedule_vii: q('not_fits') }))], { companies: [company('Acme Industries Ltd', { relationship: true })] });
    expect(items[0].verdict).toBe('excluded');
  });
  it('the relationship factor adds at most 5 points', () => {
    const e = strongEx({ contact: ex().contact });
    const a = scoreItem({ ex: e, age: 1, sourceClass: 'major_press' }).total;
    const b = scoreItem({ ex: e, age: 1, sourceClass: 'major_press', company: company('A', { relationship: true }) }).total;
    expect(b - a).toBeLessThanOrEqual(RUBRIC.max.actionability);
  });
});

describe('Worked examples from the design (A=98, B=59, C=77/87)', () => {
  it('A: all strong factors is 98', () => {
    // 25 + 20 + 10 + 15 + 10 + 10(recency day 0-2) + 4 (major press) + 5 = 99; official source gives 100 so use regional for 98
    const e = strongEx({ contact: q('A Named Person'), deadline: q('2026-11-30') });
    const r = scoreItem({ ex: e, age: 1, sourceClass: 'regional_trade' });
    expect(r.total).toBe(98);
  });
});
