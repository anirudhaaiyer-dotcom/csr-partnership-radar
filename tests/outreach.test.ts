import { describe, expect, it } from 'vitest';
import { generateOutreach, outreachFacts } from '@/lib/outreach';
import type { JsonModel } from '@/lib/gemini';

const stub = (out: unknown): JsonModel & { seen: string[] } => {
  const seen: string[] = [];
  return { name: 'stub', seen, async generateJson(system, user) { seen.push(system + '\n' + user); return out; } };
};

describe('Outreach drafts for any company', () => {
  it('builds facts only from what the user typed', () => {
    const f = outreachFacts({ company: 'Tata Motors', contact: 'Asha Rao', role: 'Head of CSR', noticed: 'They opened a skilling centre in Chakan.', tone: 'warm' });
    expect(f).toContain('Company: Tata Motors');
    expect(f).toContain('Addressee: Asha Rao, Head of CSR');
    expect(f).toContain('skilling centre in Chakan');
    expect(outreachFacts({ company: 'X', tone: 'direct' })).toContain('the CSR team');
  });
  it('passes the chosen tone to the model and returns email plus a short message', async () => {
    const m = stub({ subject: 'Hello', body: 'Hi team, a 20 minute call?', short_message: 'Hi, a quick call?' });
    const d = await generateOutreach(m, { company: 'X', tone: 'follow_up' });
    expect(m.seen[0]).toContain('follow-up');
    expect(d.short_message).toBe('Hi, a quick call?');
    expect(d.warnings).toEqual([]);
  });
  it('warns about numbers that were not in the facts', async () => {
    const m = stub({ subject: 'S', body: 'We trained 5000 youth.', short_message: 'Hi' });
    const d = await generateOutreach(m, { company: 'X', tone: 'warm' });
    expect(d.warnings.some((w) => w.includes('5000'))).toBe(true);
  });
  it('rejects an empty model answer', async () => {
    await expect(generateOutreach(stub({ subject: '', body: '' }), { company: 'X', tone: 'warm' })).rejects.toThrow();
  });
});
