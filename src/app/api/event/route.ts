import { checkWrite } from '@/lib/auth';
import { repo } from '@/lib/server';
import type { EventRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
const KINDS: EventRow['kind'][] = ['not_for_us', 'undo_not_for_us', 'relevance', 'status', 'duplicate', 'wrong_info', 'opened', 'draft_copied', 'not_duplicate'];

export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { id?: string; kind?: EventRow['kind']; payload?: Record<string, unknown> };
  if (!b.id || !b.kind || !KINDS.includes(b.kind)) return Response.json({ error: 'id and a valid kind are required' }, { status: 400 });
  await repo().addEvent({ cluster_id: b.id, kind: b.kind, payload: b.payload ?? null, at: new Date().toISOString() });
  return Response.json({ ok: true });
}
