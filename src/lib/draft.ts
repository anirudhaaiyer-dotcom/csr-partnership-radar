import type { JsonModel } from './gemini';
import { geoLabel } from './opportunities';
import { formatDate } from './time';
import type { DraftRow, Opportunity } from './types';

export const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: { subject: { type: 'STRING' }, body: { type: 'STRING' } },
  required: ['subject', 'body'],
};

const SYSTEM = `You draft a short first email from Ananya, Head of Corporate Partnerships at an education and skilling NGO in Pune that serves school dropouts and first-generation job seekers, to a company's CSR team.
Rules:
- Use only the facts provided. Do not add numbers, names, dates, programmes or claims that are not in the facts.
- Do not state anything about the company's legal obligations under CSR law.
- Under 140 words, plain and warm, no flattery, no buzzwords. Open with the specific thing you noticed. Ask for a 20-minute call.
- Sign off as Ananya. Do not invent a surname, phone number or links.
- Return JSON with subject and body.`;

export function draftFacts(o: Opportunity): string {
  const lines = [
    `Company: ${o.company}`,
    `What we noticed (quoted from the source): ${o.factors.find((f) => f.key === 'beneficiary')?.quote ?? 'beneficiary not stated'}`,
    `Signal: ${o.signal_type.replace('_', ' ')}`,
    o.factors.find((f) => f.key === 'signal')?.quote ? `Signal quote: ${o.factors.find((f) => f.key === 'signal')!.quote}` : '',
    `Geography: ${geoLabel(o.geography)}`,
    o.deadline ? `Deadline: ${formatDate(o.deadline)}` : '',
    o.contact ? `Addressee: ${o.contact}` : 'Addressee: the CSR team',
    o.factors.find((f) => f.key === 'scale')?.quote ? `Scale quote: ${o.factors.find((f) => f.key === 'scale')!.quote}` : '',
    `Source: ${o.sources[0]?.title ?? ''} (${o.sources[0]?.publisher ?? 'publisher unknown'})`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Numbers in the draft that do not appear in the facts, so the person can check them. */
export function draftWarnings(body: string, facts: string): string[] {
  const warnings: string[] = [];
  const nums = body.match(/\d[\d,.]*/g) ?? [];
  const factNums = new Set(facts.match(/\d[\d,.]*/g) ?? []);
  for (const n of nums) if (!factNums.has(n) && !['20'].includes(n)) warnings.push(`The draft contains "${n}", which is not in the card's facts.`);
  if (/\b(obliged|obligated|mandatory|legally required|must spend)\b/i.test(body)) warnings.push('The draft mentions a legal obligation. Remove it.');
  return warnings;
}

export async function generateDraft(model: JsonModel, o: Opportunity, now: Date): Promise<DraftRow> {
  const facts = draftFacts(o);
  const out = (await model.generateJson(SYSTEM, `Facts:\n${facts}`, DRAFT_SCHEMA)) as { subject?: string; body?: string };
  const subject = String(out?.subject ?? '').trim();
  const body = String(out?.body ?? '').trim();
  if (!subject || !body) throw new Error('The model returned an empty draft');
  return { cluster_id: o.id, subject, body, model: model.name, warnings: draftWarnings(body, facts), created_at: now.toISOString() };
}
