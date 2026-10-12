import { describe, expect, it } from 'vitest';
import { buildUrl, lookupContact, parseContact, LookupError } from '@/lib/lusha';

const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Lusha contact lookup', () => {
  it('needs a full name plus company, or a LinkedIn link', () => {
    expect(buildUrl({ name: 'Asha', company: 'Tata Motors' })).toBeNull();
    expect(buildUrl({ name: 'Asha Rao' })).toBeNull();
    const u = new URL(buildUrl({ name: 'Asha Rao Iyer', company: 'Tata Motors' })!);
    expect(u.searchParams.get('firstName')).toBe('Asha');
    expect(u.searchParams.get('lastName')).toBe('Rao Iyer');
    expect(u.searchParams.get('companyName')).toBe('Tata Motors');
    expect(new URL(buildUrl({ linkedin: 'https://www.linkedin.com/in/asha-rao' })!).searchParams.get('linkedinUrl')).toContain('linkedin.com/in/asha-rao');
    expect(buildUrl({ linkedin: 'https://evil.example/x' })).toBeNull();
  });
  it('reads phones and emails and keeps the do-not-call flag', () => {
    const r = parseContact({ contact: { error: null, isCreditCharged: true, data: { fullName: 'Asha Rao', jobTitle: { title: 'Head of CSR' }, company: { name: 'Tata Motors' }, phoneNumbers: [{ number: '+91 98200 00000', phoneType: 'Mobile', doNotCall: true }], emailAddresses: [{ address: 'asha@example.com', emailType: 'work', emailConfidence: 'A+' }] } } });
    expect(r.found).toBe(true);
    expect(r.phones[0]).toEqual({ number: '+91 98200 00000', kind: 'Mobile', doNotCall: true });
    expect(r.emails[0].confidence).toBe('A+');
    expect(r.creditCharged).toBe(true);
  });
  it('treats an empty answer or a 404 as no match, not a crash', async () => {
    expect(parseContact({ contact: { error: { name: 'EMPTY_DATA' } } }).found).toBe(false);
    expect((await lookupContact({ name: 'A B', company: 'C' }, 'k', ok({}, 404))).found).toBe(false);
  });
  it('sends the key in a header and explains errors in plain words', async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: string, init: RequestInit) => { seen = init; return new Response('{}', { status: 401 }); }) as unknown as typeof fetch;
    await expect(lookupContact({ name: 'A B', company: 'C' }, 'secret', f)).rejects.toThrow(LookupError);
    expect((seen!.headers as Record<string, string>).api_key).toBe('secret');
    await expect(lookupContact({ name: 'A B', company: 'C' }, 'k', ok({}, 451))).rejects.toThrow(/privacy/i);
  });
});
