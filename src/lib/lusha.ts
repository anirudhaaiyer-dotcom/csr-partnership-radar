/**
 * Contact lookup through Lusha (Person API v2, GET /v2/person).
 * Looks up one named person at one company. Called only when the user presses the button.
 * Nothing returned here is stored, and the API key never leaves the server.
 */
export type ContactResult = {
  found: boolean;
  name: string | null;
  title: string | null;
  company: string | null;
  linkedin: string | null;
  phones: { number: string; kind: string; doNotCall: boolean }[];
  emails: { address: string; kind: string; confidence: string | null }[];
  creditCharged: boolean;
  note: string | null;
};

export type ContactQuery = { name?: string; company?: string; linkedin?: string };
type Fetcher = typeof fetch;

export class LookupError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Lusha could not read that name or company.',
  401: 'The Lusha API key was rejected. Check LUSHA_API_KEY.',
  403: 'The Lusha account is inactive or its plan does not allow this lookup.',
  412: 'Lusha needs a first and last name, for example "Asha Rao".',
  429: 'Lusha rate or credit limit reached. Try again later.',
  451: 'Lusha cannot return this contact because of privacy restrictions (GDPR).',
};

export function buildUrl(q: ContactQuery): string | null {
  const linkedin = (q.linkedin ?? '').trim();
  const company = (q.company ?? '').trim();
  const parts = (q.name ?? '').trim().split(/\s+/).filter(Boolean);
  const u = new URL('https://api.lusha.com/v2/person');
  if (/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin)) {
    u.searchParams.set('linkedinUrl', linkedin);
  } else if (parts.length >= 2 && company) {
    u.searchParams.set('firstName', parts[0]);
    u.searchParams.set('lastName', parts.slice(1).join(' '));
    u.searchParams.set('companyName', company);
  } else {
    return null;
  }
  return u.toString();
}

type Raw = { contact?: { error?: { name?: string; message?: string } | null; isCreditCharged?: boolean; data?: Record<string, unknown> } };

export function parseContact(raw: unknown): ContactResult {
  const c = ((raw ?? {}) as Raw).contact;
  const d = c?.data as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!d || c?.error) {
    return { found: false, name: null, title: null, company: null, linkedin: null, phones: [], emails: [], creditCharged: !!c?.isCreditCharged, note: 'Lusha has no match for this person.' };
  }
  const phones = (Array.isArray(d.phoneNumbers) ? d.phoneNumbers : []).filter((p: any) => p?.number).map((p: any) => ({ number: String(p.number), kind: String(p.phoneType ?? 'Phone'), doNotCall: !!p.doNotCall })); // eslint-disable-line @typescript-eslint/no-explicit-any
  const emails = (Array.isArray(d.emailAddresses) ? d.emailAddresses : []).filter((e: any) => e?.address).map((e: any) => ({ address: String(e.address), kind: String(e.emailType ?? 'email'), confidence: e.emailConfidence ? String(e.emailConfidence) : null })); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    found: true,
    name: d.fullName ? String(d.fullName) : null,
    title: d.jobTitle?.title ? String(d.jobTitle.title) : null,
    company: d.company?.name ? String(d.company.name) : null,
    linkedin: d.socialLinks?.linkedin ? String(d.socialLinks.linkedin) : null,
    phones,
    emails,
    creditCharged: !!c?.isCreditCharged,
    note: phones.length || emails.length ? null : 'Lusha knows this person but has no phone or email on file.',
  };
}

export async function lookupContact(q: ContactQuery, apiKey: string, fetcher: Fetcher = fetch): Promise<ContactResult> {
  const url = buildUrl(q);
  if (!url) throw new LookupError('Enter the contact\'s full name and company, or a LinkedIn profile link.', 400);
  const res = await fetcher(url, { headers: { api_key: apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return parseContact({ contact: { error: { name: 'EMPTY_DATA' } } });
  if (!res.ok) throw new LookupError(STATUS_TEXT[res.status] ?? `Lusha answered ${res.status}.`, res.status === 401 || res.status === 403 ? 502 : res.status);
  return parseContact(await res.json().catch(() => ({})));
}
