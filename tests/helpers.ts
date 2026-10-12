import { DEFAULT_SETTINGS } from '@/lib/config';
import { emptyExtraction } from '@/lib/opportunities';
import { sha1, normalizeCompany } from '@/lib/util';
import type { Article, Company, EventRow, Extraction, Field, Settings } from '@/lib/types';

/** Synthetic fixtures for tests only. Never shown in the product. */
export const q = <T,>(value: T, quote = 'synthetic supporting quote for tests'): Field<T> => ({ value, quote, tag: 'quoted' });

export function ex(p: Partial<Extraction> = {}): Extraction {
  return { ...emptyExtraction('test'), ...p };
}

export const NOW = new Date('2026-10-12T04:00:00Z'); // Monday 09:30 IST

export function daysAgo(n: number, from = NOW): string {
  return new Date(from.getTime() - n * 86400000).toISOString();
}

export function art(id: string, e: Extraction, o: Partial<Article> = {}): Article {
  const url = o.url ?? `https://news.example.com/${id}`;
  return {
    id: sha1(id), url, title: o.title ?? `Headline ${id}`, publisher: 'Example News', publisher_domain: 'news.example.com',
    published_at: daysAgo(1), first_seen_at: daysAgo(1), source: 'seed', text: 'text', text_kind: 'body', extraction: e,
    extraction_attempts: 1, ...o,
  };
}

export function strongEx(over: Partial<Extraction> = {}): Extraction {
  return ex({
    company: q('Acme Industries Ltd'),
    signal: q('partner_search'),
    explicit_partner_search: q(true),
    beneficiary: q('dropouts_first_gen'),
    sector: q('skilling_placement'),
    geography: q('pune'),
    scale_cr: q(12),
    schedule_vii: q('fits'),
    ...over,
  });
}

export function company(name: string, o: Partial<Company> = {}): Company {
  return {
    key: normalizeCompany(name), name, section135: 'unknown', checked_on: null, source_checked: null, relationship: false,
    hq_maharashtra: false, excluded: false, excluded_reason: null, contact_name: null, contact_role: null, contact_how: null, ...o,
  };
}

export const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

export const event = (cluster_id: string, kind: EventRow['kind'], o: Partial<EventRow> = {}): EventRow => ({
  id: Math.random().toString(36).slice(2), cluster_id, kind, payload: null, at: NOW.toISOString(), ...o,
});
