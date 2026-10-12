import { buildOpportunities, selectLists, type Lists } from './opportunities';
import { checkReadiness } from './checks';
import { SEED_AS_OF } from './seed';
import { ageDays } from './time';
import type { Repo } from './repo/types';
import type { Company, Opportunity, RunRow, Settings, TriCheck } from './types';

export interface Workspace {
  now: string;
  demo: boolean;
  settings: Settings;
  companies: Company[];
  all: Opportunity[];
  lists: Lists;
  runs: RunRow[];
  lastGoodRun: RunRow | null;
  status: 'current' | 'stale' | 'failed' | 'partial' | 'never';
  readiness: TriCheck;
}

/** Demo mode shows the seed as of the day it was collected; a live deployment uses the real clock. */
export const effectiveNow = (repo: Repo): Date => (repo.demo ? new Date(SEED_AS_OF) : new Date());

export async function loadWorkspace(repo: Repo, now = effectiveNow(repo)): Promise<Workspace> {
  const settings = await repo.getSettings();
  const since = new Date(now.getTime() - (settings.discovery_window_days + 1) * 86400000).toISOString();
  const [companies, articles, events, runs] = await Promise.all([repo.listCompanies(), repo.listArticles(since), repo.listEvents(), repo.listRuns(20)]);
  const all = buildOpportunities({ articles, companies, settings, events, now });
  const lists = selectLists(all, settings);
  const finished = runs.filter((r) => r.status !== 'running' && r.status !== 'locked');
  const lastGoodRun = finished.find((r) => r.status === 'succeeded' || r.status === 'partial') ?? null;
  const latest = finished[0] ?? null;
  let status: Workspace['status'];
  if (repo.demo) status = 'never';
  else if (!latest) status = 'never';
  else if (latest.status === 'failed') status = 'failed';
  else if ((ageDays(lastGoodRun?.finished_at ?? null, now) ?? 99) > settings.stale_after_days) status = 'stale';
  else status = latest.status === 'partial' ? 'partial' : 'current';
  return { now: now.toISOString(), demo: repo.demo, settings, companies, all, lists, runs, lastGoodRun, status, readiness: checkReadiness(settings, now) };
}
