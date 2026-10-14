import { LOCK_TTL_MINUTES, MAX_EXTRACT_PER_RUN, MAX_UPGRADE_PER_RUN } from './config';
import { extractBatch, looksRelevant } from './extract';
import type { JsonModel } from './gemini';
import type { FetchLike } from './http';
import { loadSeedArticles } from './seed';
import { ageDays } from './time';
import { buildQueries, fetchBingNews, fetchGdelt, fetchGoogleNews, gdeltQueries, type RawItem } from './sources/feeds';
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
    // Bing News runs alongside Google: its links go straight to the publisher, so full article text can be fetched
    const bing = await fetchBingNews(buildQueries(settings, companies), deps.fetchImpl, deps.pauseMs ?? 400);
    sources.push(bing.stat);
    let items = [...google.items, ...bing.items];
    if ((!google.stat.ok && !bing.stat.ok) || items.length === 0 || deps.probe) {
      const g = await fetchGdelt(gdeltQueries(settings), deps.fetchImpl, deps.gdeltPauseMs ?? 5200);
      sources.push(g.stat);
      items = items.concat(g.items);
    }
    const anySourceOk = sources.some((s) => s.ok && s.items > 0);
    if (sources.some((s) => !s.ok)) status = 'partial';

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
    // Articles first read from the headline alone get one more try on the full page, so the score reflects the whole article.
    const upgrades = existing
      .filter((a) => a.extraction && a.text_kind === 'snippet_only' && a.extraction_attempts < 2 && a.source !== 'seed' && looksRelevant(a))
      .sort((a, b) => (b.published_at ?? b.first_seen_at).localeCompare(a.published_at ?? a.first_seen_at));
    const upgradeBatch = model ? upgrades.slice(0, Math.min(MAX_EXTRACT_PER_RUN - batch.length, MAX_UPGRADE_PER_RUN)) : [];
    const work = [...batch, ...upgradeBatch];

    if (!model) {
      notes.push('GEMINI_API_KEY is not set, so no extraction ran.');
      queued += batch.length;
      if (batch.length) status = status === 'failed' ? 'failed' : 'partial';
    } else if (work.length) {
      // 5. best-effort full text, a few at a time, inside a time budget
      const fetchText = deps.fetchText ?? ((u: string) => fetchArticleText(u, deps.fetchImpl));
      const deadline = Date.now() + (deps.textBudgetMs ?? 120000);
      const bodies = new Map<string, string>();
      for (let i = 0; i < work.length && Date.now() < deadline; i += 5) {
        await Promise.all(work.slice(i, i + 5).map(async (a) => {
          const body = await fetchText(a.url);
          if (body) bodies.set(a.id, body);
        }));
      }
      // An upgrade only goes back to the model when the full page was actually read; otherwise it keeps its first result.
      const forModel = work
        .filter((a) => !a.extraction || bodies.has(a.id))
        .map((a) => (bodies.has(a.id) ? { ...a, text: `${a.title}\n${bodies.get(a.id)}`, text_kind: 'body' as const } : a));
      for (const a of upgradeBatch) if (!bodies.has(a.id)) await repo.saveExtraction(a.id, a.extraction, a.extraction_attempts + 1);
      const res = await extractBatch(model, forModel);
      let upgraded = 0;
      for (const a of forModel) {
        const ex = res.done.get(a.id);
        const text = a.text_kind === 'body' ? { text: a.text, kind: a.text_kind } : undefined;
        if (ex) {
          await repo.saveExtraction(a.id, ex, a.extraction_attempts + 1, text);
          if (a.extraction) upgraded++; else extracted++;
        } else if (!res.quotaHit) {
          // a failed re-read never wipes an earlier result
          await repo.saveExtraction(a.id, a.extraction ?? null, a.extraction_attempts + 1, text);
        }
      }
      if (upgraded) notes.push(`${upgraded} earlier items were re-read on the full article and re-scored.`);
      queued += res.failed.length;
      if (res.quotaHit) {
        notes.push(`Gemini quota reached${res.quotaRetryAfter ? ` (retry after ${res.quotaRetryAfter}s)` : ''}. ${res.failed.length} articles stay queued for the next run.`);
        sources.push({ source: 'Gemini Flash', ok: false, items: extracted, error_class: 'quota', detail: 'Rate limit or daily quota reached' });
        if (status === 'succeeded') status = 'partial';
      } else {
        sources.push({ source: 'Gemini Flash', ok: true, items: extracted, error_class: null, detail: `${bodies.size} of ${work.length} pages gave full article text; the rest used the headline` });
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
