import { checkWrite } from '@/lib/auth';
import { generateDraft } from '@/lib/draft';
import { model, repo } from '@/lib/server';
import { loadWorkspace } from '@/lib/workspace';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Pursue: record the choice and create one draft email from the card's quoted facts. Nothing is sent. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
  const r = repo();
  const ws = await loadWorkspace(r);
  const opp = ws.all.find((o) => o.id === id);
  if (!opp) return Response.json({ error: 'Opportunity not found' }, { status: 404 });
  if (!opp.pursued) await r.addEvent({ cluster_id: id, kind: 'pursue', payload: null, at: new Date().toISOString() });
  let draft = await r.getDraft(id);
  let error: string | null = null;
  if (!draft) {
    const m = model();
    if (!m) error = 'GEMINI_API_KEY is not set, so no draft was created. You can write one below.';
    else {
      try {
        draft = await generateDraft(m, opp, new Date());
        await r.saveDraft(draft);
      } catch (e) {
        error = `The draft could not be created: ${(e as Error).message}`;
      }
    }
  }
  return Response.json({ draft, error });
}
