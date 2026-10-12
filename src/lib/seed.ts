import seedJson from '../../seed/seed.json';
import { emptyExtraction } from './opportunities';
import { sha1, normalizeUrl } from './util';
import type { Article, Extraction, Field } from './types';

type Pair = [string | number, string];
interface SeedItem {
  url: string; title: string; publisher: string; publisher_domain: string; published_at: string;
  quotes: string[]; verbatim_confidence: string; ex: Record<string, Pair>;
}

export const SEED_AS_OF: string = (seedJson as { asOf: string }).asOf;

const f = <T,>(p: Pair | undefined): Field<T> =>
  p ? { value: p[0] as T, quote: p[1], tag: 'quoted' } : { value: null, quote: null, tag: 'not_stated' };

/** Real headlines and short quotes, extracted by hand. Every quote is checked against the stored text by a test. */
export function loadSeedArticles(): Article[] {
  return (seedJson as unknown as { articles: SeedItem[] }).articles.map((s) => {
    const text = [s.title, ...s.quotes].join('\n');
    const base = emptyExtraction('seed-manual');
    const ex: Extraction = {
      ...base,
      company: f(s.ex.company), signal: f(s.ex.signal), beneficiary: f(s.ex.beneficiary), sector: f(s.ex.sector),
      geography: f(s.ex.geography), scale_cr: f(s.ex.scale_cr), contact: f(s.ex.contact), foundation: f(s.ex.foundation),
      deadline: f(s.ex.deadline), apply_link: f(s.ex.apply_link), schedule_vii: f(s.ex.schedule_vii),
      explicit_partner_search: f(s.ex.explicit_partner_search),
    };
    return {
      id: sha1(normalizeUrl(s.url)), url: s.url, title: s.title, publisher: s.publisher, publisher_domain: s.publisher_domain,
      published_at: new Date(s.published_at).toISOString(), first_seen_at: new Date(s.published_at).toISOString(), source: 'seed' as const,
      text, text_kind: 'snippet_only' as const, extraction: ex, extraction_attempts: 1,
    };
  });
}
