import { LOCK_TTL_MINUTES, MAX_EXTRACT_PER_RUN } from './config';
import { extractBatch, looksRelevant } from './extract';
import type { JsonModel } from './gemini';
import type { FetchLike } from './http';
import { loadSeedArticles } from './seed';
import { ageDays } from './time';
import { buildQueries, fetchGdelt, fetchGoogleNews, gdeltQueries, type RawItem } from './sources/feeds';
import { fetchArticleText } from './sources/articleText';
import { domainOf, normalizeUrl, sha1 } from './util';
import type { Article, RunRow, SourceStat } from './types';
import type { Repo } from './repo/types';

export interface PipelineDeps {
  repo: Repo;
  now: Date;
  model: JsonModel | null;
  fetchImpl?: FetchLike;
  fetchText?: (url: string) => Promise<string | null>;
  pauseMs?: number;
  gdeltPauseMs?: number;
  /** run GDELT even when Google News worked (the source probe) */
  probe?: boolean;
  textBudgetMs?: number;
}

export function rawToArticle(r: RawItem, now: Date): Article {
  const text = [r.title, r.snippet].filter(Boolean).join('\n');
  return {
    id: sha1(normalizeUrl(r.url)), url: r.url, title: r.title, publisher: r.publisher,
    publisher_domain: r.publisher_domain ?? domainOf(r.url), published_at: r.published_at, first_seen_at: now.toISOString(),
    source: r.source, text, text_kind: 'snippet_only', extraction: null, extraction_attempts: 0,
  };
}

export async function runPipeline(deps: PipelineDeps, trigger: RunRow['trigger']): Promise<RunRow> {
  const { repo, now, model } = deps;
  const run = await repo.startRun(trigger, LOCK_TTL_MINUTES, now);
  if (!run) {
    return { id: 'locked', started_at: now.toISOString(), finished_at: now.toISOString(), status: 'locked', reviewed: 0, extracted: 0, queued: 0, sources: [], notes: ['Another run is in progress'], trigger };
  }
  const notes: string[] = [];
  const sources: SourceStat[] = [];
  let status: RunRow['status'] = 'succeeded';
  try {
    const [settings, companies] = await Promise.all([repo.getSettings(), repo.listCompanies()]);
    const windowStart = new Date(now.getTime() - (settings.discovery_window_days + 1) * 86400000).toISOString();

    // 1. sources: Google News first, GDELT when Google fails or returns nothing (or when probing)
    const google = await fetchGoogleNews(buildQueries(settings, companies), deps.fetchImpl, deps.pauseMs ?? 400);
    sources.push(google.stat);
    let items = [...google.items];
    if (!google.stat.ok || google.items.length === 0 || deps.probe) {
      const g = await fetchGdelt(gdeltQueries(settings), deps.fetchImpl, deps.gdeltPauseMs ?? 5200);
      sources.push(g.stat);
      items = items.concat(g.items);
    }
    const anySourceOk = sources.some((s) => s.ok && s.items > 0);
    if (sources.some((s) => !s.ok || s.error_class)) status = 'partial';

    // 2. normalise, drop outside the discovery window, store only new articles
    const seen = new Set<string>();
    const fresh: Article[] = [];
    for (const r of items) {
      const a = rawToArticle(r, now);
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const age = ageDays(a.published_at, now);
      if (age !== null && age > settings.discovery_window_days) continue;
      fresh.push(a);
    }
    const inserted = await repo.insertNewArticles(fresh);
    notes.push(`${items.length} items fetched, ${fresh.length} inside the window, ${inserted} new`);

    // 3. seeded fallback only when nothing live came back and the store is empty
    let existing = await repo.listArticles(windowStart);
    if (!anySourceOk && existing.length === 0) {
      const added = await repo.insertNewArticles(loadSeedArticles());
      notes.push(`No live source returned items. Added ${added} seeded items as a labelled fallback.`);
      existing = await repo.listArticles('1970-01-01T00:00:00Z');
      status = 'failed';
    } else if (!anySourceOk) {
      status = 'failed';
    }

    // 4. which articles need extraction
    const todo = existing
      .filter((a) => !a.extraction && a.extraction_attempts < 3 && a.source !== 'seed' && looksRelevant(a))
      .sort((a, b) => (b.published_at ?? b.first_seen_at).localeCompare(a.published_at ?? a.first_seen_at));
    const batch = todo.slice(0, MAX_EXTRACT_PER_RUN);
    let queued = todo.length - batch.length;
    let extracted = 0;

    if (!model) {
      notes.push('GEMINI_API_KEY is not set, so no extraction ran.');
      queued += batch.length;
      if (batch.length) status = status === 'failed' ? 'failed' : 'partial';
    } else if (batch.length) {
      // 5. best-effort full text, a few at a time, inside a time budget
      const fetchText = deps.fetchText ?? ((u: string) => fetchArticleText(u, deps.fetchImpl));
      const deadline = Date.now() + (deps.textBudgetMs ?? 60000);
      const bodies = new Map<string, string>();
      for (let i = 0; i < batch.length && Date.now() < deadline; i += 5) {
        await Promise.all(batch.slice(i, i + 5).map(async (a) => {
          const body = await fetchText(a.url);
          if (body) bodies.set(a.id, body);
        }));
      }
      const forModel = batch.map((a) => (bodies.has(a.id) ? { ...a, text: `${a.title}\n${bodies.get(a.id)}`, text_kind: 'body' as const } : a));
      const res = await extractBatch(model, forModel);
      for (const a of forModel) {
        const ex = res.done.get(a.id);
        const text = a.text_kind === 'body' ? { text: a.text, kind: a.text_kind } : undefined;
        if (ex) {
          await repo.saveExtraction(a.id, ex, a.extraction_attempts + 1, text);
          extracted++;
        } else if (!res.quotaHit) {
          await repo.saveExtraction(a.id, null, a.extraction_attempts + 1, text);
        }
      }
      queued += res.failed.length;
      if (res.quotaHit) {
        notes.push(`Gemini quota reached${res.quotaRetryAfter ? ` (retry after ${res.quotaRetryAfter}s)` : ''}. ${res.failed.length} articles stay queued for the next run.`);
        sources.push({ source: 'Gemini Flash', ok: false, items: extracted, error_class: 'quota', detail: 'Rate limit or daily quota reached' });
        if (status === 'succeeded') status = 'partial';
      } else {
        sources.push({ source: 'Gemini Flash', ok: true, items: extracted, error_class: null, detail: `${bodies.size} of ${batch.length} pages gave body text; the rest used the headline` });
        if (res.failed.length && status === 'succeeded') status = 'partial';
      }
    }

    const done: Partial<RunRow> = { status, finished_at: new Date().toISOString(), reviewed: existing.length, extracted, queued, sources, notes };
    await repo.finishRun(run.id, done);
    return { ...run, ...done } as RunRow;
  } catch (e) {
    notes.push(`Run error: ${(e as Error).message}`);
    const done: Partial<RunRow> = { status: 'failed', finished_at: new Date().toISOString(), sources, notes };
    await repo.finishRun(run.id, done);
    return { ...run, ...done } as RunRow;
  }
}
