import { buildActivity, buildDigest, sendDigest, type SendResult } from './digest';
import type { JsonModel } from './gemini';
import type { FetchLike } from './http';
import { runPipeline } from './pipeline';
import type { Repo } from './repo/types';
import { istWeekday, weekStartIST } from './time';
import { loadWorkspace } from './workspace';

export interface WeeklyDeps {
  repo: Repo;
  now: Date;
  model: JsonModel | null;
  env: { RESEND_API_KEY?: string; DIGEST_FROM?: string; DIGEST_TO?: string; APP_URL?: string };
  fetchImpl?: FetchLike;
  fetchText?: (url: string) => Promise<string | null>;
  pauseMs?: number;
  gdeltPauseMs?: number;
}

export type WeeklyResult =
  | { action: 'idle'; reason: string }
  | { action: 'locked' }
  | { action: 'ran'; runStatus: string; send: SendResult; variant: string };

/**
 * Called once a day by the scheduler (Vercel Hobby allows one run per day).
 * Monday: refresh data and send the digest. Tuesday or Wednesday: only if Monday's digest was never sent,
 * then it goes out once, marked as delayed. Any other day does nothing.
 * Duplicate or late invocations are harmless because the send is keyed on (recipient, week).
 */
export async function runWeekly(d: WeeklyDeps): Promise<WeeklyResult> {
  const settings = await d.repo.getSettings();
  const to = settings.digest_to || d.env.DIGEST_TO;
  const week = weekStartIST(d.now);
  const dow = istWeekday(d.now); // 1 = Monday

  if (to) {
    const existing = await d.repo.getDigest(to, week);
    if (existing?.status === 'sent') return { action: 'idle', reason: 'This week’s digest was already sent' };
  }
  const delayed = dow === 2 || dow === 3;
  if (dow !== 1 && !delayed) return { action: 'idle', reason: 'Not a digest day' };

  const run = await runPipeline({ repo: d.repo, now: d.now, model: d.model, fetchImpl: d.fetchImpl, fetchText: d.fetchText, pauseMs: d.pauseMs, gdeltPauseMs: d.gdeltPauseMs }, delayed ? 'catchup' : 'cron');
  if (run.status === 'locked') return { action: 'locked' };

  const ws = await loadWorkspace(d.repo, d.now);
  const content = buildDigest({
    lists: ws.lists, now: d.now, appUrl: d.env.APP_URL || '', latestRun: run, lastGoodRunDate: ws.lastGoodRun?.finished_at ?? null,
    delayed, reviewed: run.reviewed, activity: buildActivity(ws.all, await d.repo.listEvents(), d.now),
  });
  const send = await sendDigest({ repo: d.repo, resendKey: d.env.RESEND_API_KEY, from: d.env.DIGEST_FROM, to, now: d.now, fetchImpl: d.fetchImpl }, content);
  return { action: 'ran', runStatus: run.status, send, variant: content.variant };
}
