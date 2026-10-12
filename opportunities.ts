import { MAX_DIGEST_CALLS } from './config';
import { checkExclusions, checkReadiness, checkScheduleVII, checkSection135, companyMatch } from './checks';
import { scoreItem } from './scoring';
import { ageDays, formatDate, isoToDay, istDay, nextMondayDay } from './time';
import { classifySource, domainOf, jaccard, normalizeCompany, normalizeUrl, titleTokens } from './util';
import { decide } from './verdict';
import type {
  Article, ArticleRef, Company, Confidence, Extraction, EventRow, Opportunity, Settings, SourceClass, TriCheck,
} from './types';

export function emptyExtraction(by = 'none'): Extraction {
  const nf = <T,>() => ({ value: null as T | null, quote: null, tag: 'not_stated' as const });
  return {
    company: nf(), signal: nf(), explicit_partner_search: nf(), beneficiary: nf(), sector: nf(), geography: nf(),
    scale_cr: nf(), deadline: nf(), contact: nf(), foundation: nf(), apply_link: nf(), schedule_vii: nf(),
    rejected_quotes: [], extracted_by: by,
  };
}

const quotedCount = (ex: Extraction) =>
  (['company', 'signal', 'beneficiary', 'sector', 'geography', 'scale_cr', 'deadline', 'contact', 'foundation', 'schedule_vii'] as const)
    .filter((k) => ex[k].tag === 'quoted').length;

const hasCompany = (a: Article) => !!a.extraction && a.extraction.company.tag === 'quoted' && !!a.extraction.company.value;

function sameStory(a: Article, b: Article, notDup: Set<string>): boolean {
  const pair = [a.id, b.id].sort().join('|');
  if (notDup.has(pair)) return false;
  if (normalizeUrl(a.url) === normalizeUrl(b.url)) return true;
  const ea = a.extraction!, eb = b.extraction!;
  if (normalizeCompany(ea.company.value!) !== normalizeCompany(eb.company.value!)) return false;
  if (ea.signal.value !== eb.signal.value) return false;
  const pa = a.published_at ? Date.parse(a.published_at) : Date.parse(a.first_seen_at);
  const pb = b.published_at ? Date.parse(b.published_at) : Date.parse(b.first_seen_at);
  if (Math.abs(pa - pb) > 7 * 86400000) return false;
  const sameDeadline = !!ea.deadline.value && ea.deadline.value === eb.deadline.value;
  return sameDeadline || jaccard(titleTokens(a.title), titleTokens(b.title)) >= 0.3;
}

export function clusterArticles(articles: Article[], notDup: Set<string> = new Set()): Article[][] {
  const items = articles.filter(hasCompany);
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (find(i) !== find(j) && sameStory(items[i], items[j], notDup)) parent[find(j)] = find(i);
  const groups = new Map<number, Article[]>();
  items.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(a);
  });
  return [...groups.values()].map((g) => g.sort((x, y) => x.first_seen_at.localeCompare(y.first_seen_at) || x.id.localeCompare(y.id)));
}

const GEO_LABEL: Record<string, string> = {
  pune: 'Pune', maharashtra: 'Maharashtra', pan_india: 'Pan-India', base_maharashtra: 'Company base in Maharashtra', other: 'Other',
};
export const geoLabel = (g: string) => GEO_LABEL[g] ?? g;

function confidenceOf(core: { signal: boolean; beneficiary: boolean; geography: boolean; date: boolean }, cls: SourceClass): Confidence {
  const missing = [core.signal, core.beneficiary, core.geography, core.date].filter((x) => !x).length;
  if (missing >= 2 || cls === 'blog') return 'low';
  if (missing === 0 && (cls === 'official' || cls === 'major_press')) return 'high';
  return 'medium';
}

export interface BuildContext {
  articles: Article[];
  companies: Company[];
  settings: Settings;
  events: EventRow[];
  now: Date;
}

export function buildOpportunities(ctx: BuildContext): Opportunity[] {
  const { companies, settings, events, now } = ctx;
  const notDup = new Set(events.filter((e) => e.kind === 'not_duplicate').map((e) => String(e.payload?.pair ?? '')));
  const shown = new Set(events.filter((e) => e.kind === 'shown').map((e) => e.cluster_id));
  const latestState = (id: string, a: string, b: string) => {
    const last = events.filter((e) => e.cluster_id === id && (e.kind === a || e.kind === b)).sort((x, y) => x.at.localeCompare(y.at)).at(-1);
    return last?.kind === a;
  };
  const readiness = checkReadiness(settings, now);
  const today = istDay(now);
  const nextMon = nextMondayDay(now);

  const out: Opportunity[] = [];
  for (const members of clusterArticles(ctx.articles, notDup)) {
    const id = members[0].id;
    const rep = [...members].sort((a, b) => quotedCount(b.extraction!) - quotedCount(a.extraction!))[0];
    const ex = rep.extraction!;
    const companyName = ex.company.value!;
    const ckey = normalizeCompany(companyName);
    const company = companyMatch(companies, companyName);

    const pubs = members.map((m) => m.published_at).filter(Boolean) as string[];
    const earliestPub = pubs.length ? pubs.sort()[0] : null;
    const firstSeen = members.map((m) => m.first_seen_at).sort()[0];
    const lastUpdated = members.map((m) => m.first_seen_at).sort().at(-1)!;
    const age = ageDays(earliestPub ?? firstSeen, now);

    // deadline history across members in order of discovery
    let deadline: string | null = null;
    const history: Opportunity['deadline_history'] = [];
    for (const m of members) {
      const d = m.extraction!.deadline;
      const v = d.tag === 'quoted' && d.value ? d.value : null;
      if (v && deadline && v !== deadline) history.push({ from: deadline, to: v, at: m.first_seen_at });
      if (v) deadline = v;
    }

    const sources: ArticleRef[] = members.map((m) => ({
      id: m.id, url: m.url, title: m.title, publisher: m.publisher, published_at: m.published_at,
      source_class: classifySource(m.publisher_domain ?? domainOf(m.url), ckey),
    }));
    const bestClass = (['official', 'major_press', 'regional_trade', 'blog'] as const).find((c) => sources.some((s) => s.source_class === c))!;

    const exUsed: Extraction = { ...ex, deadline: deadline ? { value: deadline, quote: ex.deadline.quote ?? members.map((m) => m.extraction!.deadline.quote).find(Boolean) ?? null, tag: 'quoted' } : ex.deadline };
    const sc = scoreItem({ ex: exUsed, age, sourceClass: bestClass, company });
    const fresh = scoreItem({ ex: exUsed, age, sourceClass: bestClass, company, fresh: true });

    const text = members.map((m) => m.title + ' ' + m.text).join(' ');
    const checks: Opportunity['checks'] = {
      schedule_vii: checkScheduleVII(ex),
      section135: checkSection135(company),
      exclusions: checkExclusions(company, settings, text),
    };
    const signal = ex.signal.tag === 'quoted' && ex.signal.value ? ex.signal.value : 'none';
    const explicit = ex.explicit_partner_search.tag === 'quoted' && ex.explicit_partner_search.value === true && signal === 'partner_search';
    const benPts = sc.factors.find((f) => f.key === 'beneficiary')!.points;
    const dec = decide({ signal, explicitPartnerSearch: explicit, total: sc.total, beneficiaryPoints: benPts, checks, readiness, settings });
    const freshDec = decide({ signal, explicitPartnerSearch: explicit, total: fresh.total, beneficiaryPoints: benPts, checks, readiness, settings });

    const isOpen = !!deadline && isoToDay(deadline) >= today;
    const closing = isOpen && isoToDay(deadline!) < nextMon;
    const supported = sc.factors.filter((f) => f.tag !== 'not_stated').length;
    const confidence = confidenceOf(
      {
        signal: sc.factors[0].tag === 'quoted', beneficiary: sc.factors[1].tag === 'quoted',
        geography: sc.factors[3].tag === 'quoted' || sc.factors[3].tag === 'list', date: !!earliestPub,
      },
      bestClass,
    );

    const benF = sc.factors[1];
    const why_matters = benF.quote ? `“${benF.quote}”` : 'Beneficiary not stated in the source';
    const why_now = isOpen
      ? `Open call closes ${formatDate(deadline)}`
      : `First seen ${formatDate(firstSeen)}${earliestPub ? `, published ${formatDate(earliestPub)}` : ''}`;
    const contact = company?.contact_name ? [company.contact_name, company.contact_role].filter(Boolean).join(', ') : ex.contact.tag === 'quoted' ? ex.contact.value : null;
    const foundation = ex.foundation.tag === 'quoted' ? ex.foundation.value : null;
    const next_action = nextAction({ verdict: dec.verdict, isOpen, deadline, s135: checks.section135, contact, foundation });

    out.push({
      id, company: companyName, company_key: ckey, signal_type: signal, verdict: dec.verdict, verdict_reason: dec.reason,
      total: dec.verdict === 'policy' || dec.verdict === 'excluded' ? null : sc.total,
      fresh_total: dec.verdict === 'policy' || dec.verdict === 'excluded' ? null : fresh.total,
      factors: sc.factors, checks, confidence, supported_fields: supported, geography: sc.geography, geography_tag: sc.geographyTag,
      published_at: earliestPub, first_seen_at: firstSeen, last_updated_at: lastUpdated, deadline, deadline_history: history,
      age_days: age, closing_before_next_monday: closing, is_open_call: isOpen, relationship: !!company?.relationship, contact,
      why_matters, why_now, next_action, sources, shown_before: shown.has(id),
      dismissed: latestState(id, 'not_for_us', 'undo_not_for_us'), pursued: events.some((e) => e.cluster_id === id && e.kind === 'pursue'),
      late_find: false, fresh_verdict: freshDec.verdict,
    });
  }
  return out;
}

function nextAction(p: { verdict: Opportunity['verdict']; isOpen: boolean; deadline: string | null; s135: TriCheck; contact: string | null; foundation: string | null }): string {
  if (p.verdict === 'policy') return 'Read the change and note anything that affects your eligibility';
  if (p.verdict === 'excluded') return 'No action: a mandatory check failed';
  if (p.verdict === 'skip') return 'No action';
  if (p.verdict === 'watch') return p.isOpen ? `Keep watching; closes ${formatDate(p.deadline)}` : 'Keep watching';
  const verify = p.s135.state === 'unknown' ? 'Verify Section 135 status, then ' : '';
  const target = p.contact ? `reach out to ${p.contact}` : p.foundation ? `reach out through ${p.foundation}` : 'reach out to the CSR team (no contact on file)';
  const first = p.isOpen ? `apply before ${formatDate(p.deadline)}; ${target}` : target;
  const sentence = verify + first;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export interface Lists {
  call: Opportunity[];
  watch: Opportunity[];
  policy: Opportunity[];
  closing: Opportunity[];
  late: Opportunity[];
  excluded: Opportunity[];
  skipped: number;
}

const rank = (a: Opportunity, b: Opportunity) =>
  Number(b.relationship) - Number(a.relationship) ||
  (b.total ?? 0) - (a.total ?? 0) ||
  (b.published_at ?? '').localeCompare(a.published_at ?? '');

/** Splits opportunities into the lists the workspace and the digest use. */
export function selectLists(all: Opportunity[], settings: Settings): Lists {
  const inPool = (o: Opportunity) => (o.age_days !== null && o.age_days <= settings.main_window_days) || o.is_open_call;
  const live = all.filter((o) => !o.dismissed);
  const pool = live.filter(inPool);
  const call = pool.filter((o) => o.verdict === 'call').sort(rank);
  const watch = pool.filter((o) => o.verdict === 'watch').sort(rank);
  const policy = pool.filter((o) => o.verdict === 'policy');
  const closing = pool.filter((o) => o.closing_before_next_monday && (o.verdict === 'call' || o.verdict === 'watch'))
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''));
  const late = live
    .filter((o) => !inPool(o) && !o.shown_before && o.age_days !== null && o.age_days > settings.main_window_days && o.age_days <= settings.discovery_window_days)
    .filter((o) => o.fresh_verdict === 'call' && (o.fresh_total ?? 0) >= settings.late_min_fresh_score)
    .sort((a, b) => (b.fresh_total ?? 0) - (a.fresh_total ?? 0))
    .slice(0, settings.late_max)
    .map((o) => ({ ...o, late_find: true }));
  return {
    call, watch, policy, closing, late,
    excluded: pool.filter((o) => o.verdict === 'excluded'),
    skipped: pool.filter((o) => o.verdict === 'skip').length,
  };
}

export const digestCalls = (l: Lists) => l.call.slice(0, MAX_DIGEST_CALLS);
