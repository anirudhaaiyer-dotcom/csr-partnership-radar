/**
 * Find the people to contact at a company through Lusha (v3 API).
 * Step 1, search: POST /v3/contacts/prospecting with the company name and CSR-type job titles. Returns names, titles and LinkedIn.
 * Step 2, reveal: POST /v3/contacts/enrich for one chosen person. Returns phone and email; this is the step that spends credits.
 * Both run only when the user presses a button. Nothing is stored, and the API key never leaves the server.
 */
import { LookupError } from '@/lib/lusha';

type Fetcher = typeof fetch;

export type Person = {
  id: string;
  name: string;
  title: string | null;
  seniority: string | null;
  location: string | null;
  linkedin: string | null;
};

export type PeopleResult = { people: Person[]; total: number | null; creditsCharged: number | null; note: string | null };

export type Revealed = {
  phones: { number: string; kind: string; doNotCall: boolean }[];
  emails: { address: string; kind: string; confidence: string | null }[];
  creditsCharged: number | null;
  note: string | null;
};

/** Job titles that usually own CSR partnerships. Matching is done by Lusha. */
export const CSR_TITLES = ['CSR', 'Corporate Social Responsibility', 'Sustainability', 'ESG', 'Corporate Affairs', 'Foundation', 'Philanthropy', 'Social Impact', 'Community'];

const STATUS_TEXT: Record<number, string> = {
  400: 'Lusha could not read that search.',
  401: 'The Lusha API key was rejected. Check LUSHA_API_KEY.',
  402: 'The Lusha account has no credits left.',
  403: 'The Lusha plan does not allow people search. Use the LinkedIn-link lookup instead.',
  429: 'Lusha rate or credit limit reached. Try again later.',
};

export function buildSearchBody(company: string, size = 10) {
  return {
    pagination: { page: 0, size },
    filters: {
      contacts: { include: { jobTitles: CSR_TITLES } },
      companies: { include: { names: [company] } },
    },
    options: { includePartialProfiles: true, excludeDnc: false },
  };
}

export function parsePeople(raw: unknown): PeopleResult {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const list: any[] = Array.isArray(r.results) ? r.results : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const people: Person[] = list
    .filter((p) => p && p.id && !p.error)
    .map((p) => {
      const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || (p.fullName ? String(p.fullName) : '');
      const loc = p.location ? [p.location.city, p.location.country].filter(Boolean).join(', ') : '';
      return {
        id: String(p.id),
        name: name || 'Name hidden by Lusha',
        title: p.jobTitle?.title ? String(p.jobTitle.title) : null,
        seniority: p.jobTitle?.seniority ? String(p.jobTitle.seniority) : null,
        location: loc || null,
        linkedin: p.socialLinks?.linkedin ? String(p.socialLinks.linkedin) : null,
      };
    });
  return {
    people,
    total: typeof r.pagination?.total === 'number' ? r.pagination.total : null,
    creditsCharged: typeof r.billing?.creditsCharged === 'number' ? r.billing.creditsCharged : null,
    note: people.length ? null : 'Lusha found no CSR or sustainability contacts at this company.',
  };
}

export function parseRevealed(raw: unknown): Revealed {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = (Array.isArray(r.results) ? r.results[0] : null) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const credits = typeof r.billing?.creditsCharged === 'number' ? r.billing.creditsCharged : null;
  if (!d || d.error) {
    return { phones: [], emails: [], creditsCharged: credits, note: 'Lusha could not reveal details for this person.' };
  }
  const phones = (Array.isArray(d.phones) ? d.phones : []).filter((p: any) => p?.number).map((p: any) => ({ number: String(p.number), kind: String(p.type ?? 'phone'), doNotCall: !!p.doNotCall })); // eslint-disable-line @typescript-eslint/no-explicit-any
  const emails = (Array.isArray(d.emails) ? d.emails : []).filter((e: any) => e?.email).map((e: any) => ({ address: String(e.email), kind: String(e.type ?? 'email'), confidence: e.confidence ? String(e.confidence) : null })); // eslint-disable-line @typescript-eslint/no-explicit-any
  return { phones, emails, creditsCharged: credits, note: phones.length || emails.length ? null : 'Lusha knows this person but has no phone or email on file.' };
}

async function call(url: string, body: unknown, apiKey: string, fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher(url, { method: 'POST', headers: { api_key: apiKey, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new LookupError(STATUS_TEXT[res.status] ?? `Lusha answered ${res.status}.`, res.status === 401 || res.status === 403 ? 502 : res.status);
  return res.json().catch(() => ({}));
}

export async function searchPeople(company: string, apiKey: string, fetcher: Fetcher = fetch): Promise<PeopleResult> {
  const c = company.trim();
  if (!c) throw new LookupError('Which company? The company name is missing.', 400);
  return parsePeople(await call('https://api.lusha.com/v3/contacts/prospecting', buildSearchBody(c), apiKey, fetcher));
}

export async function revealPerson(id: string, apiKey: string, fetcher: Fetcher = fetch): Promise<Revealed> {
  const i = id.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(i)) throw new LookupError('That contact id is not valid.', 400);
  return parseRevealed(await call('https://api.lusha.com/v3/contacts/enrich', { ids: [i], reveal: ['emails', 'phones'] }, apiKey, fetcher));
}
