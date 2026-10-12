import { checkCron } from '@/lib/auth';
import { appEnv, model, repo } from '@/lib/server';
import { runWeekly } from '@/lib/weekly';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = checkCron(req);
  if (denied) return denied;
  const r = repo();
  if (r.demo) return Response.json({ action: 'idle', reason: 'Demo mode: no database connected' });
  const result = await runWeekly({ repo: r, now: new Date(), model: model(), env: appEnv() });
  return Response.json(result);
}
