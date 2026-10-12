import { EXTRACT_BATCH } from './config';
import { QuotaError } from './http';
import type { JsonModel } from './gemini';
import { emptyExtraction } from './opportunities';
import { isIsoDate } from './time';
import { quoteInText } from './util';
import type { Article, Extraction, Field } from './types';

const SIGNAL = ['partner_search', 'initiative_budget', 'allocation', 'policy', 'none'] as const;
const BENEFICIARY = ['dropouts_first_gen', 'low_income_youth', 'youth_general', 'none'] as const;
const SECTOR = ['skilling_placement', 'digital_youth_employment', 'other_education', 'none'] as const;
const GEOGRAPHY = ['pune', 'maharashtra', 'pan_india', 'other'] as const;
const VII = ['fits', 'not_fits'] as const;

const fieldSchema = (valueSchema: Record<string, unknown>) => ({
  type: 'OBJECT',
  properties: { value: { ...valueSchema, nullable: true }, quote: { type: 'STRING', nullable: true } },
  required: ['value', 'quote'],
});
const enumSchema = (vals: readonly string[]) => fieldSchema({ type: 'STRING', enum: [...vals] });

export const EXTRACTION_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      company: fieldSchema({ type: 'STRING' }),
      signal: enumSchema(SIGNAL),
      explicit_partner_search: fieldSchema({ type: 'BOOLEAN' }),
      beneficiary: enumSchema(BENEFICIARY),
      sector: enumSchema(SECTOR),
      geography: enumSchema(GEOGRAPHY),
      scale_cr: fieldSchema({ type: 'NUMBER' }),
      deadline: fieldSchema({ type: 'STRING' }),
      contact: fieldSchema({ type: 'STRING' }),
      foundation: fieldSchema({ type: 'STRING' }),
      apply_link: fieldSchema({ type: 'STRING' }),
      schedule_vii: enumSchema(VII),
    },
    required: ['id', 'company', 'signal', 'explicit_partner_search', 'beneficiary', 'sector', 'geography', 'scale_cr', 'deadline', 'contact', 'foundation', 'apply_link', 'schedule_vii'],
  },
};

export const EXTRACTION_SYSTEM = `You extract structured facts from news about corporate social responsibility (CSR) in India, for an education and skilling NGO in Pune.
Rules:
- Use only the text given for each article. Do not use outside knowledge and do not guess.
- Every field has a value and a quote. The quote must be copied exactly, character for character, from that article's text (10 to 200 characters). If the text does not support a field, set both value and quote to null.
- company: the corporate that would fund or runs the CSR programme (not the NGO or the publisher).
- signal: partner_search = the company or its foundation is inviting NGOs or implementation partners (RFP, EOI, call for proposals); initiative_budget = a new initiative with a stated budget; allocation = a general CSR spend or allocation announcement; policy = a change in CSR law, rules or guidance; none = anything else.
- explicit_partner_search: true only if the text itself says partners or proposals are being sought.
- beneficiary: dropouts_first_gen = school or college dropouts, first-generation learners or first-time job seekers; low_income_youth = disadvantaged, rural or underserved youth; youth_general = youth or students without that detail; none.
- sector: skilling_placement = skilling with placement or jobs; digital_youth_employment = digital literacy or youth employment; other_education = other education; none.
- geography: where the programme operates, from the text only: pune, maharashtra, pan_india, other.
- scale_cr: the amount in Indian crore (1 crore = 10 million rupees); convert lakh or million to crore.
- deadline: a submission or application deadline as yyyy-mm-dd, only if the text states one.
- contact, foundation, apply_link: only if named in the text.
- schedule_vii: fits = the text describes an activity in education, vocational skills or livelihood enhancement; not_fits = it clearly describes something else; otherwise null.
Return one object per article, with the same id.`;

type RawField = { value?: unknown; quote?: unknown } | undefined;

function field<T>(raw: RawField, ok: (v: unknown) => v is T, text: string, name: string, rejected: string[]): Field<T> {
  const none: Field<T> = { value: null, quote: null, tag: 'not_stated' };
  if (!raw || raw.value === null || raw.value === undefined) return none;
  if (!ok(raw.value)) return none;
  const quote = typeof raw.quote === 'string' ? raw.quote : null;
  if (!quoteInText(quote, text)) {
    rejected.push(name);
    return none;
  }
  return { value: raw.value, quote, tag: 'quoted' };
}

const isOneOf = <T extends string>(vals: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (vals as readonly string[]).includes(v);

/** Turns one raw model object into a verified Extraction. A field without an exact quote in `text` is dropped. */
export function verifyExtraction(raw: Record<string, RawField>, text: string, model: string): Extraction {
  const rejected: string[] = [];
  const base = emptyExtraction(model);
  const ex: Extraction = {
    ...base,
    company: field(raw.company, (v): v is string => typeof v === 'string' && v.trim().length > 1, text, 'company', rejected),
    signal: field(raw.signal, isOneOf(SIGNAL), text, 'signal', rejected),
    explicit_partner_search: field(raw.explicit_partner_search, (v): v is boolean => typeof v === 'boolean', text, 'explicit_partner_search', rejected),
    beneficiary: field(raw.beneficiary, isOneOf(BENEFICIARY), text, 'beneficiary', rejected),
    sector: field(raw.sector, isOneOf(SECTOR), text, 'sector', rejected),
    geography: field(raw.geography, isOneOf(GEOGRAPHY), text, 'geography', rejected),
    scale_cr: field(raw.scale_cr, (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0, text, 'scale_cr', rejected),
    deadline: field(raw.deadline, (v): v is string => isIsoDate(v), text, 'deadline', rejected),
    contact: field(raw.contact, (v): v is string => typeof v === 'string' && v.trim().length > 2, text, 'contact', rejected),
    foundation: field(raw.foundation, (v): v is string => typeof v === 'string' && v.trim().length > 2, text, 'foundation', rejected),
    apply_link: field(raw.apply_link, (v): v is string => typeof v === 'string' && v.trim().length > 4, text, 'apply_link', rejected),
    schedule_vii: field(raw.schedule_vii, isOneOf(VII), text, 'schedule_vii', rejected),
    rejected_quotes: rejected,
    extracted_by: model,
  };
  // 'none' means the model found nothing: treat as not stated rather than as a quoted value
  for (const k of ['signal', 'beneficiary', 'sector'] as const) {
    if (ex[k].value === 'none') ex[k] = { value: null, quote: null, tag: 'not_stated' };
  }
  return ex;
}

/** Cheap pre-filter so model requests go to articles that could plausibly matter. */
export function looksRelevant(a: Pick<Article, 'title' | 'text'>): boolean {
  const t = `${a.title} ${a.text}`.toLowerCase();
  // The feed queries are already CSR-scoped, and many headlines say "launches skilling programme" without the word CSR,
  // so a topic match alone is enough to be worth a model look. The model decides whether it is a real signal.
  return /(educat|skill|school|student|youth|digital literacy|livelihood|employab|vocational|dropout|scholarship|training|placement|upskill|apprentice)/.test(t);
}

export interface ExtractResult {
  done: Map<string, Extraction>;
  failed: string[];
  quotaHit: boolean;
  quotaRetryAfter: number | null;
}

export async function extractBatch(model: JsonModel, articles: Article[]): Promise<ExtractResult> {
  const done = new Map<string, Extraction>();
  const failed: string[] = [];
  let quotaHit = false;
  let quotaRetryAfter: number | null = null;
  for (let i = 0; i < articles.length; i += EXTRACT_BATCH) {
    const batch = articles.slice(i, i + EXTRACT_BATCH);
    const user = batch
      .map((a) => `### ARTICLE id=${a.id}\nTITLE: ${a.title}\nPUBLISHED: ${a.published_at ?? 'unknown'}\nTEXT:\n${a.text}`)
      .join('\n\n');
    try {
      const out = (await model.generateJson(EXTRACTION_SYSTEM, user, EXTRACTION_SCHEMA)) as Record<string, RawField>[] | unknown;
      const rows = Array.isArray(out) ? (out as (Record<string, RawField> & { id?: string })[]) : [];
      for (const a of batch) {
        const row = rows.find((r) => (r.id as unknown as string) === a.id);
        if (!row) {
          failed.push(a.id);
          continue;
        }
        done.set(a.id, verifyExtraction(row, `${a.title}\n${a.text}`, model.name));
      }
    } catch (e) {
      if (e instanceof QuotaError) {
        quotaHit = true;
        quotaRetryAfter = e.retryAfterSeconds;
        failed.push(...articles.slice(i).map((a) => a.id)); // stop; the rest stay queued
        break;
      }
      failed.push(...batch.map((a) => a.id));
    }
  }
  return { done, failed, quotaHit, quotaRetryAfter };
}
