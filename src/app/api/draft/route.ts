import { checkWrite } from '@/lib/auth';
import { repo } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { id?: string; subject?: string; body?: string };
  if (!b.id || typeof b.subject !== 'string' || typeof b.body !== 'string') return Response.json({ error: 'id, subject and body are required' }, { status: 400 });
  const r = repo();
  const prev = await r.getDraft(b.id);
  await r.saveDraft({ cluster_id: b.id, subject: b.subject.slice(0, 300), body: b.body.slice(0, 5000), model: prev?.model ?? 'manual', warnings: prev?.warnings ?? [], created_at: prev?.created_at ?? new Date().toISOString() });
  return Response.json({ ok: true });
}
