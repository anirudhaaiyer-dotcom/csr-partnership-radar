import { draftWarnings } from './draft';
import type { JsonModel } from './gemini';

export const TONES = ['warm', 'direct', 'follow_up'] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABEL: Record<Tone, string> = { warm: 'Warm introduction', direct: 'Short and direct', follow_up: 'Follow-up nudge' };

export interface OutreachInput {
  company: string;
  contact?: string;
  role?: string;
  noticed?: string;
  ask?: string;
  tone: Tone;
}

export interface OutreachDraft {
  subject: string;
  body: string;
  short_message: string;
  warnings: string[];
  model: string;
}

export const OUTREACH_SCHEMA = {
  type: 'OBJECT',
  properties: { subject: { type: 'STRING' }, body: { type: 'STRING' }, short_message: { type: 'STRING' } },
  required: ['subject', 'body', 'short_message'],
};

const TONE_RULE: Record<Tone, string> = {
  warm: 'Tone: warm and human. Open with the specific thing noticed, then one sentence on the NGO, then the ask. Under 150 words.',
  direct: 'Tone: short and direct, for a busy CSR head. Three or four sentences, no pleasantries beyond a greeting. Under 90 words.',
  follow_up: 'Tone: a polite follow-up to an earlier unanswered email. Refer to "my earlier note" without inventing its date or content. Under 80 words.',
};

const SYSTEM = `You draft outreach from Ananya, Head of Corporate Partnerships at an education and skilling NGO in Pune that serves school dropouts and first-generation job seekers, to a company's CSR team.
Rules:
- Use only the facts provided. Do not add numbers, names, dates, programmes, results or claims that are not in the facts.
- Do not say anything about the company's legal obligations under CSR law.
- No flattery, no buzzwords. Ask for a 20-minute call unless the facts give a different ask.
- Sign off as Ananya. Do not invent a surname, phone number, website or links.
- If an addressee name is given, greet them by it; otherwise greet "the CSR team".
- Return JSON with: subject (email subject), body (the email), short_message (a 2-3 sentence version for LinkedIn or WhatsApp, same facts only).`;

export function outreachFacts(i: OutreachInput): string {
  return [
    `Company: ${i.company}`,
    i.contact ? `Addressee: ${i.contact}${i.role ? `, ${i.role}` : ''}` : 'Addressee: the CSR team',
    i.noticed ? `What we noticed: ${i.noticed}` : 'What we noticed: nothing specific provided; keep the opening general and honest.',
    i.ask ? `Our ask: ${i.ask}` : '',
  ].filter(Boolean).join('\n');
}

export async function generateOutreach(model: JsonModel, i: OutreachInput): Promise<OutreachDraft> {
  const facts = outreachFacts(i);
  const out = (await model.generateJson(`${SYSTEM}\n${TONE_RULE[i.tone]}`, `Facts:\n${facts}`, OUTREACH_SCHEMA)) as { subject?: string; body?: string; short_message?: string };
  const subject = String(out?.subject ?? '').trim();
  const body = String(out?.body ?? '').trim();
  const short_message = String(out?.short_message ?? '').trim();
  if (!subject || !body) throw new Error('The model returned an empty draft');
  return { subject, body, short_message, warnings: draftWarnings(`${body}\n${short_message}`, facts), model: model.name };
}
