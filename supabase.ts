import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS } from '../config';
import type { Article, Company, DigestRow, DraftRow, EventRow, RunRow, Settings } from '../types';
import type { Repo } from './types';

const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

export function createSupabaseRepo(url: string, serviceKey: string): Repo {
  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const toArticle = (r: Record<string, unknown>): Article => ({
    id: r.id as string, url: r.url as string, title: r.title as string, publisher: (r.publisher as string) ?? null,
    publisher_domain: (r.publisher_domain as string) ?? null, published_at: (r.published_at as string) ?? null,
    first_seen_at: r.first_seen_at as string, source: r.source as Article['source'], text: (r.text as string) ?? '',
    text_kind: (r.text_kind as Article['text_kind']) ?? 'snippet_only', extraction: (r.extraction as Article['extraction']) ?? null,
    extraction_attempts: (r.extraction_attempts as number) ?? 0,
  });
  const toRun = (r: Record<string, unknown>): RunRow => ({
    id: r.id as string, started_at: r.started_at as string, finished_at: (r.finished_at as string) ?? null, status: r.status as RunRow['status'],
    reviewed: r.reviewed as number, extracted: r.extracted as number, queued: r.queued as number,
    sources: (r.sources as RunRow['sources']) ?? [], notes: (r.notes as string[]) ?? [], trigger: r.trigger as RunRow['trigger'],
  });

  return {
    kind: 'supabase',
    demo: false,
    async getSettings() {
      const r = await db.from('settings').select('data').eq('id', 1).maybeSingle();
      const data = must(r, 'read settings') as { data: Partial<Settings> } | null;
      return { ...DEFAULT_SETTINGS, ...(data?.data ?? {}) };
    },
    async saveSettings(s) {
      must(await db.from('settings').upsert({ id: 1, data: s, updated_at: new Date().toISOString() }), 'save settings');
    },
    async listCompanies() {
      const rows = must(await db.from('companies').select('data'), 'list companies') as { data: Company }[];
      return rows.map((r) => r.data);
    },
    async upsertCompany(c) {
      must(await db.from('companies').upsert({ key: c.key, data: c, updated_at: new Date().toISOString() }), 'save company');
    },
    async deleteCompany(key) {
      must(await db.from('companies').delete().eq('key', key), 'delete company');
    },
    async listArticles(sinceIso) {
      const rows = must(await db.from('articles').select('*').gte('first_seen_at', sinceIso).order('first_seen_at', { ascending: false }).limit(2000), 'list articles') as Record<string, unknown>[];
      return rows.map(toArticle);
    },
    async insertNewArticles(list) {
      if (!list.length) return 0;
      const rows = list.map((a) => ({ ...a }));
      // ignoreDuplicates keeps the original first_seen_at for articles we already have
      const res = await db.from('articles').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id');
      return (must(res, 'insert articles') as unknown[]).length;
    },
    async saveExtraction(id, extraction, attempts, text) {
      const patch: Record<string, unknown> = { extraction, extraction_attempts: attempts };
      if (text) { patch.text = text.text; patch.text_kind = text.kind; }
      must(await db.from('articles').update(patch).eq('id', id), 'save extraction');
    },
    async listEvents() {
      return must(await db.from('events').select('*').order('at', { ascending: true }).limit(5000), 'list events') as EventRow[];
    },
    async addEvent(e) {
      must(await db.from('events').insert({ cluster_id: e.cluster_id, kind: e.kind, payload: e.payload, at: e.at }), 'add event');
    },
    async getDraft(id) {
      const r = await db.from('drafts').select('*').eq('cluster_id', id).maybeSingle();
      return must(r, 'read draft') as DraftRow | null;
    },
    async saveDraft(d) {
      must(await db.from('drafts').upsert(d), 'save draft');
    },
    async getDigest(recipient, week) {
      const r = await db.from('digests').select('*').eq('recipient', recipient).eq('week_start', week).maybeSingle();
      return must(r, 'read digest') as DigestRow | null;
    },
    async createDigest(d) {
      const r = await db.from('digests').insert(d).select('*').maybeSingle();
      if (r.error) {
        if ((r.error as { code?: string }).code === '23505') return null; // unique (recipient, week_start)
        throw new Error(`create digest: ${r.error.message}`);
      }
      return r.data as DigestRow;
    },
    async updateDigest(id, patch) {
      must(await db.from('digests').update(patch).eq('id', id), 'update digest');
    },
    async startRun(trigger, ttl, now) {
      const cutoff = new Date(now.getTime() - ttl * 60000).toISOString();
      must(
        await db.from('run_log').update({ status: 'failed', finished_at: now.toISOString(), notes: ['Marked failed: lock expired'] }).eq('status', 'running').lt('started_at', cutoff),
        'expire stale runs',
      );
      const r = await db.from('run_log').insert({ status: 'running', trigger, started_at: now.toISOString() }).select('*').maybeSingle();
      if (r.error) {
        if ((r.error as { code?: string }).code === '23505') return null; // another run holds the lock
        throw new Error(`start run: ${r.error.message}`);
      }
      return toRun(r.data as Record<string, unknown>);
    },
    async finishRun(id, patch) {
      must(await db.from('run_log').update(patch).eq('id', id), 'finish run');
    },
    async listRuns(limit) {
      const rows = must(await db.from('run_log').select('*').order('started_at', { ascending: false }).limit(limit), 'list runs') as Record<string, unknown>[];
      return rows.map(toRun);
    },
  };
}
