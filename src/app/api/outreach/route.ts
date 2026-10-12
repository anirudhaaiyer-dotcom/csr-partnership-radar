import { checkWrite } from '@/lib/auth';
import { generateOutreach, TONES, type Tone } from '@/lib/outreach';
import { model } from '@/lib/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Draft an outreach email for any company. Nothing is sent and nothing is stored. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = clip(b.company, 120);
  if (!company) return Response.json({ error: 'Company name is required' }, { status: 400 });
  const tone = (TONES as readonly string[]).includes(String(b.tone)) ? (b.tone as Tone) : 'warm';
  const m = model();
  if (!m) return Response.json({ error: 'GEMINI_API_KEY is not set, so no draft was created.' }, { status: 503 });
  try {
    const draft = await generateOutreach(m, { company, contact: clip(b.contact, 120), role: clip(b.role, 120), noticed: clip(b.noticed, 600), ask: clip(b.ask, 300), tone });
    return Response.json({ draft });
  } catch (e) {
    return Response.json({ error: `The draft could not be created: ${(e as Error).message}` }, { status: 502 });
  }
}
