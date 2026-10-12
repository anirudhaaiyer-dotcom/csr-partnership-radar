import { describe, expect, it } from 'vitest';
import { LookupError } from '@/lib/lusha';
import { CSR_TITLES, buildSearchBody, parsePeople, parseRevealed, revealPerson, searchPeople } from '@/lib/lushaProspect';

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Lusha people search and reveal', () => {
  it('searches by company name and CSR job titles, one small page', () => {
    const b = buildSearchBody('MediaTek');
    expect(b.filters.companies.include.names).toEqual(['MediaTek']);
    expect(b.filters.contacts.include.jobTitles).toEqual(CSR_TITLES);
    expect(CSR_TITLES).toContain('Sustainability');
    expect(b.pagination).toEqual({ page: 0, size: 10 });
  });
  it('turns search results into names, titles and LinkedIn links', () => {
    const r = parsePeople({ results: [{ id: '1', firstName: 'Asha', lastName: 'Rao', jobTitle: { title: 'Head of CSR', seniority: 'Director' }, location: { city: 'Pune', country: 'India' }, socialLinks: { linkedin: 'https://www.linkedin.com/in/asha' } }, { id: '2', error: 'x' }, { firstName: 'No', lastName: 'Id' }], pagination: { total: 1 }, billing: { creditsCharged: 1 } });
    expect(r.people).toHaveLength(1);
    expect(r.people[0]).toMatchObject({ id: '1', name: 'Asha Rao', title: 'Head of CSR', location: 'Pune, India', linkedin: 'https://www.linkedin.com/in/asha' });
    expect(r.creditsCharged).toBe(1);
    expect(parsePeople({ results: [] }).note).toMatch(/no CSR/i);
  });
  it('reads revealed phones and emails and keeps the do-not-call flag', () => {
    const r = parseRevealed({ results: [{ id: '1', phones: [{ number: '+919820000000', type: 'mobile', doNotCall: true }], emails: [{ email: 'asha@example.com', type: 'work', confidence: 'A+' }] }], billing: { creditsCharged: 2 } });
    expect(r.phones[0]).toEqual({ number: '+919820000000', kind: 'mobile', doNotCall: true });
    expect(r.emails[0]).toEqual({ address: 'asha@example.com', kind: 'work', confidence: 'A+' });
    expect(r.creditsCharged).toBe(2);
    expect(parseRevealed({ results: [{ id: '1', error: 'NOT_FOUND' }] }).note).toMatch(/could not reveal/i);
  });
  it('sends the key in a header, rejects bad input and explains errors', async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: string, init: RequestInit) => { seen = init; return new Response('{"results":[]}', { status: 200 }); }) as unknown as typeof fetch;
    await searchPeople('Tata Motors', 'secret', f);
    expect((seen!.headers as Record<string, string>).api_key).toBe('secret');
    await expect(searchPeople('  ', 'k', reply({}))).rejects.toThrow(LookupError);
    await expect(revealPerson('../x', 'k', reply({}))).rejects.toThrow(/not valid/);
    await expect(searchPeople('A', 'k', reply({}, 402))).rejects.toThrow(/credits/i);
    await expect(searchPeople('A', 'k', reply({}, 403))).rejects.toThrow(/plan/i);
  });
});
