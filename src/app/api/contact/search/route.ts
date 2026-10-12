import { checkWrite } from '@/lib/auth';
import { LookupError } from '@/lib/lusha';
import { searchPeople } from '@/lib/lushaProspect';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/** List the CSR and sustainability people Lusha knows at a company. Names, titles and LinkedIn only. Nothing is stored. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const key = process.env.LUSHA_API_KEY;
  if (!key) return Response.json({ error: 'Contact search is not switched on. Add LUSHA_API_KEY on the server to enable it.' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = typeof b.company === 'string' ? b.company.trim().slice(0, 120) : '';
  try {
    return Response.json(await searchPeople(company, key));
  } catch (e) {
    const status = e instanceof LookupError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
