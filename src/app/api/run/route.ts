import { checkWrite } from '@/lib/auth';
import { runPipeline } from '@/lib/pipeline';
import { model, repo } from '@/lib/server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const r = repo();
  if (r.demo) return Response.json({ error: 'Demo mode: connect a database (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) to run live.' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { probe?: boolean };
  const run = await runPipeline({ repo: r, now: new Date(), model: model(), probe: !!body.probe }, 'manual');
  return Response.json(run);
}
