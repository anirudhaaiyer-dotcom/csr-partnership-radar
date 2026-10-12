import { checkWrite } from '@/lib/auth';
import { buildActivity, buildDigest, sendTestDigest } from '@/lib/digest';
import { appEnv, repo } from '@/lib/server';
import { loadWorkspace } from '@/lib/workspace';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Sends one test copy of the current digest to the configured recipient. Does not affect the real Monday send. */
export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const r = repo();
  if (r.demo) return Response.json({ error: 'Demo mode: connect a database first.' }, { status: 400 });
  const env = appEnv();
  const settings = await r.getSettings();
  const to = settings.digest_to || env.DIGEST_TO;
  const now = new Date();
  const ws = await loadWorkspace(r, now);
  const latest = (await r.listRuns(1))[0] ?? null;
  const content = buildDigest({ lists: ws.lists, now, appUrl: env.APP_URL || '', latestRun: latest, lastGoodRunDate: ws.lastGoodRun?.finished_at ?? null, delayed: false, reviewed: latest?.reviewed ?? 0, activity: buildActivity(ws.all, await r.listEvents(), now) });
  const sent = await sendTestDigest({ resendKey: env.RESEND_API_KEY, from: env.DIGEST_FROM, to, now }, content);
  if (!sent.ok) return Response.json({ ok: false, error: sent.error }, { status: sent.status });
  return Response.json({ ok: true, id: sent.id, to, variant: content.variant, subject: content.subject });
}
