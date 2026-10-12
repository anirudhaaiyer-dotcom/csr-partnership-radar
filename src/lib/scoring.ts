import { RUBRIC } from './config';
import type { Company, Extraction, FactorScore, GeographyLevel, SourceClass, Tag } from './types';

export interface ScoreInput {
  ex: Extraction;
  age: number | null;
  sourceClass: SourceClass;
  company?: Company | null;
  /** score as if published today (used for late finds) */
  fresh?: boolean;
}

export interface ScoreResult {
  factors: FactorScore[];
  total: number;
  geography: GeographyLevel;
  geographyTag: Tag;
}

const quoted = <T,>(f: { value: T | null; tag: string; quote: string | null }): boolean =>
  f.tag === 'quoted' && f.value !== null && !!f.quote;

export function recencyPoints(age: number | null, fresh = false): number {
  if (fresh) return RUBRIC.max.recency;
  if (age === null) return 0;
  for (const b of RUBRIC.recency) if (age <= b.maxAge) return b.points;
  return 0;
}

export function scalePoints(cr: number | null): number {
  if (cr === null || Number.isNaN(cr)) return RUBRIC.scaleUnstated;
  for (const b of RUBRIC.scaleBands) if (cr >= b.minCr) return b.points;
  return RUBRIC.scaleUnder1;
}

export function scoreItem(inp: ScoreInput): ScoreResult {
  const { ex, age, sourceClass, company, fresh } = inp;
  const f: FactorScore[] = [];

  // Signal strength
  const sigOk = quoted(ex.signal);
  f.push({
    key: 'signal', label: 'Signal strength', max: RUBRIC.max.signal,
    points: sigOk ? RUBRIC.signal[ex.signal.value!] : 0,
    tag: sigOk ? 'quoted' : 'not_stated', quote: sigOk ? ex.signal.quote : null,
    note: sigOk ? null : 'Signal not supported by a quote',
  });

  // Beneficiary fit
  const benOk = quoted(ex.beneficiary);
  f.push({
    key: 'beneficiary', label: 'Beneficiary fit', max: RUBRIC.max.beneficiary,
    points: benOk ? RUBRIC.beneficiary[ex.beneficiary.value!] : 0,
    tag: benOk ? 'quoted' : 'not_stated', quote: benOk ? ex.beneficiary.quote : null,
    note: benOk ? null : 'Beneficiary not stated',
  });

  // Sector fit
  const secOk = quoted(ex.sector);
  f.push({
    key: 'sector', label: 'Sector fit', max: RUBRIC.max.sector,
    points: secOk ? RUBRIC.sector[ex.sector.value!] : 0,
    tag: secOk ? 'quoted' : 'not_stated', quote: secOk ? ex.sector.quote : null,
    note: secOk ? null : 'Sector not stated',
  });

  // Geography fit: best of the quoted geography and the company list (HQ in Maharashtra)
  let geo: GeographyLevel = 'other';
  let geoPts = 0;
  let geoTag: Tag = 'not_stated';
  let geoQuote: string | null = null;
  let geoNote: string | null = 'Geography not stated';
  if (quoted(ex.geography)) {
    geo = ex.geography.value!;
    geoPts = RUBRIC.geography[geo];
    geoTag = 'quoted';
    geoQuote = ex.geography.quote;
    geoNote = null;
  }
  if (company?.hq_maharashtra && RUBRIC.geography.base_maharashtra > geoPts) {
    geo = 'base_maharashtra';
    geoPts = RUBRIC.geography.base_maharashtra;
    geoTag = 'list';
    geoQuote = null;
    geoNote = 'Company base in Maharashtra, from your company list';
  }
  f.push({ key: 'geography', label: 'Geography fit', max: RUBRIC.max.geography, points: geoPts, tag: geoTag, quote: geoQuote, note: geoNote });

  // Scale
  const scaleOk = quoted(ex.scale_cr);
  f.push({
    key: 'scale', label: 'Scale', max: RUBRIC.max.scale,
    points: scalePoints(scaleOk ? ex.scale_cr.value : null),
    tag: scaleOk ? 'quoted' : 'not_stated', quote: scaleOk ? ex.scale_cr.quote : null,
    note: scaleOk ? null : `Amount not stated: neutral ${RUBRIC.scaleUnstated} points`,
  });

  // Recency (metadata)
  f.push({
    key: 'recency', label: 'Recency', max: RUBRIC.max.recency,
    points: recencyPoints(age, fresh), tag: 'metadata', quote: null,
    note: fresh ? 'Scored as if published today' : age === null ? 'No published date' : `${age} day${age === 1 ? '' : 's'} old`,
  });

  // Source credibility (metadata)
  f.push({
    key: 'source', label: 'Source credibility', max: RUBRIC.max.source,
    points: RUBRIC.source[sourceClass], tag: 'metadata', quote: null, note: sourceClass.replace('_', ' '),
  });

  // Actionability
  let actPts: number = RUBRIC.actionability.none;
  let actTag: Tag = 'not_stated';
  let actQuote: string | null = null;
  let actNote: string | null = 'No named contact, deadline or link';
  const namedFromText = quoted(ex.contact) || quoted(ex.deadline) || quoted(ex.apply_link);
  if (company?.relationship) {
    actPts = RUBRIC.actionability.named; actTag = 'list'; actNote = 'Existing relationship, from your company list';
  } else if (company?.contact_name) {
    actPts = RUBRIC.actionability.named; actTag = 'list'; actNote = 'Contact on your company list';
  } else if (namedFromText) {
    actPts = RUBRIC.actionability.named; actTag = 'quoted';
    actQuote = (quoted(ex.contact) ? ex.contact.quote : quoted(ex.deadline) ? ex.deadline.quote : ex.apply_link.quote) ?? null;
    actNote = null;
  } else if (quoted(ex.foundation)) {
    actPts = RUBRIC.actionability.foundation; actTag = 'quoted'; actQuote = ex.foundation.quote; actNote = 'Named foundation';
  }
  f.push({ key: 'actionability', label: 'Actionability', max: RUBRIC.max.actionability, points: actPts, tag: actTag, quote: actQuote, note: actNote });

  const total = f.reduce((s, x) => s + x.points, 0);
  return { factors: f, total, geography: geo, geographyTag: geoTag };
}
