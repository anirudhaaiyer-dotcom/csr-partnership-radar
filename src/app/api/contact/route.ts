import { checkWrite } from '@/lib/auth';
import { LookupError, lookupContact } from '@/lib/lusha';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Find a named contact's work phone and email through Lusha. Used only on request; nothing is stored or sent. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const key = process.env.LUSHA_API_KEY;
  if (!key) return Response.json({ error: 'Contact lookup is not switched on. Add LUSHA_API_KEY on the server to enable it.' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const contact = await lookupContact({ name: clip(b.name, 120), company: clip(b.company, 120), linkedin: clip(b.linkedin, 300) }, key);
    return Response.json({ contact });
  } catch (e) {
    const status = e instanceof LookupError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Lookup failed' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
