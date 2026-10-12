import { checkWrite } from '@/lib/auth';
import { LookupError } from '@/lib/lusha';
import { revealPerson } from '@/lib/lushaProspect';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/** Reveal the work phone and email of one person chosen from the search list. Spends Lusha credits; nothing is stored or sent. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const key = process.env.LUSHA_API_KEY;
  if (!key) return Response.json({ error: 'Contact lookup is not switched on. Add LUSHA_API_KEY on the server to enable it.' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id : '';
  try {
    return Response.json({ revealed: await revealPerson(id, key) });
  } catch (e) {
    const status = e instanceof LookupError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Reveal failed' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
