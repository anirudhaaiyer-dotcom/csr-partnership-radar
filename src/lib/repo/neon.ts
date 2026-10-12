import { neon } from '@neondatabase/serverless';
import { DEFAULT_SETTINGS } from '../config';
import type { Article, Company, DigestRow, DraftRow, EventRow, RunRow, Settings } from '../types';
import { SCHEMA } from './schema';
import type { Repo } from './types';

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

export function createNeonRepo(connectionString: string): Repo {
  const sql = neon(connectionString);
  const q = async (text: string, params: unknown[] = []): Promise<Row[]> => (await sql.query(text, params)) as unknown as Row[];

  let ready: Promise<void> | null = null;
  const ensure = () => {
    if (!ready) {
      ready = (async () => { for (const stmt of SCHEMA) await sql.query(stmt, []); })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  };
  const run = async (text: string, params: unknown[] = []) => { await ensure(); return q(text, params); };

  const toArticle = (r: Row): Article => ({
    id: r.id as string, url: r.url as string, title: r.title as string, publisher: (r.publisher as string) ?? null,
    publisher_domain: (r.publisher_domain as string) ?? null, published_at: iso(r.published_at),
    first_seen_at: iso(r.first_seen_at) as string, source: r.source as Article['source'], text: (r.text as string) ?? '',
    text_kind: (r.text_kind as Article['text_kind']) ?? 'snippet_only', extraction: (r.extraction as Article['extraction']) ?? null,
    extraction_attempts: (r.extraction_attempts as number) ?? 0,
  });
  const toRun = (r: Row): RunRow => ({
    id: r.id as string, started_at: iso(r.started_at) as string, finished_at: iso(r.finished_at), status: r.status as RunRow['status'],
    reviewed: r.reviewed as number, extracted: r.extracted as number, queued: r.queued as number,
    sources: (r.sources as RunRow['sources']) ?? [], notes: (r.notes as string[]) ?? [], trigger: r.trigger as RunRow['trigger'],
  });
  const toDigest = (r: Row): DigestRow => ({
    id: r.id as string, recipient: r.recipient as string, week_start: r.week_start as string, status: r.status as DigestRow['status'],
    variant: r.variant as DigestRow['variant'], resend_id: (r.resend_id as string) ?? null, error: (r.error as string) ?? null,
    created_at: iso(r.created_at) as string, sent_at: iso(r.sent_at),
  });
  const toDraft = (r: Row): DraftRow => ({
    cluster_id: r.cluster_id as string, subject: r.subject as string, body: r.body as string, model: r.model as string,
    warnings: (r.warnings as string[]) ?? [], created_at: iso(r.created_at) as string,
  });

  const DIGEST_COLS = 'id::text as id, recipient, week_start::text as week_start, status, variant, resend_id, error, created_at, sent_at';
  const RUN_COLS = 'id::text as id, started_at, finished_at, status, reviewed, extracted, queued, sources, notes, trigger';

  return {
    kind: 'neon',
    demo: false,
    async getSettings() {
      const rows = await run('select data from settings where id = 1');
      return { ...DEFAULT_SETTINGS, ...((rows[0]?.data as Partial<Settings>) ?? {}) };
    },
    async saveSettings(s) {
      await run('insert into settings (id, data, updated_at) values (1, $1::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()', [json(s)]);
    },
    async listCompanies() {
      const rows = await run('select data from companies');
      return rows.map((r) => r.data as Company);
    },
    async upsertCompany(c) {
      await run('insert into companies (key, data, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set data = excluded.data, updated_at = now()', [c.key, json(c)]);
    },
    async deleteCompany(key) {
      await run('delete from companies where key = $1', [key]);
    },
    async listArticles(sinceIso) {
      const rows = await run('select * from articles where first_seen_at >= $1 order by first_seen_at desc limit 2000', [sinceIso]);
      return rows.map(toArticle);
    },
    async insertNewArticles(list) {
      if (!list.length) return 0;
      let inserted = 0;
      for (let i = 0; i < list.length; i += 50) {
        const chunk = list.slice(i, i + 50);
        const params: unknown[] = [];
        const values = chunk.map((a) => {
          const base = params.length;
          params.push(a.id, a.url, a.title, a.publisher, a.publisher_domain, a.published_at, a.first_seen_at, a.source, a.text, a.text_kind, json(a.extraction), a.extraction_attempts);
          return `(${Array.from({ length: 12 }, (_, k) => (k === 10 ? `$${base + k + 1}::jsonb` : `$${base + k + 1}`)).join(', ')})`;
        });
        // do nothing on conflict keeps the original first_seen_at for articles we already have
        const rows = await run(
          `insert into articles (id, url, title, publisher, publisher_domain, published_at, first_seen_at, source, text, text_kind, extraction, extraction_attempts) values ${values.join(', ')} on conflict (id) do nothing returning id`,
          params,
        );
        inserted += rows.length;
      }
      return inserted;
    },
    async saveExtraction(id, extraction, attempts, text) {
      if (text) await run('update articles set extraction = $2::jsonb, extraction_attempts = $3, text = $4, text_kind = $5 where id = $1', [id, json(extraction), attempts, text.text, text.kind]);
      else await run('update articles set extraction = $2::jsonb, extraction_attempts = $3 where id = $1', [id, json(extraction), attempts]);
    },
    async listEvents() {
      const rows = await run('select id::text as id, cluster_id, kind, payload, at from events order by at asc limit 5000');
      return rows.map((r) => ({ id: r.id as string, cluster_id: r.cluster_id as string, kind: r.kind as EventRow['kind'], payload: (r.payload as EventRow['payload']) ?? null, at: iso(r.at) as string }));
    },
    async addEvent(e) {
      await run('insert into events (cluster_id, kind, payload, at) values ($1, $2, $3::jsonb, $4)', [e.cluster_id, e.kind, json(e.payload), e.at]);
    },
    async getDraft(id) {
      const rows = await run('select * from drafts where cluster_id = $1', [id]);
      return rows[0] ? toDraft(rows[0]) : null;
    },
    async saveDraft(d) {
      await run(
        'insert into drafts (cluster_id, subject, body, model, warnings, created_at) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (cluster_id) do update set subject = excluded.subject, body = excluded.body, model = excluded.model, warnings = excluded.warnings',
        [d.cluster_id, d.subject, d.body, d.model, json(d.warnings ?? []), d.created_at],
      );
    },
    async getDigest(recipient, week) {
      const rows = await run(`select ${DIGEST_COLS} from digests where recipient = $1 and week_start = $2::date`, [recipient, week]);
      return rows[0] ? toDigest(rows[0]) : null;
    },
    async createDigest(d) {
      try {
        const rows = await run(
          `insert into digests (recipient, week_start, status, variant, resend_id, error, created_at, sent_at) values ($1, $2::date, $3, $4, $5, $6, $7, $8) returning ${DIGEST_COLS}`,
          [d.recipient, d.week_start, d.status, d.variant, d.resend_id, d.error, d.created_at, d.sent_at],
        );
        return rows[0] ? toDigest(rows[0]) : null;
      } catch (e) {
        if (uniqueViolation(e)) return null; // unique (recipient, week_start)
        throw e;
      }
    },
    async updateDigest(id, patch) {
      const cols = ['status', 'variant', 'resend_id', 'error', 'sent_at'] as const;
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const c of cols) if (c in patch) { params.push((patch as Record<string, unknown>)[c]); sets.push(`${c} = $${params.length}`); }
      if (sets.length) await run(`update digests set ${sets.join(', ')} where id = $1::uuid`, params);
    },
    async startRun(trigger, ttl, now) {
      const cutoff = new Date(now.getTime() - ttl * 60000).toISOString();
      await run(`update run_log set status = 'failed', finished_at = $1, notes = '["Marked failed: lock expired"]'::jsonb where status = 'running' and started_at < $2`, [now.toISOString(), cutoff]);
      try {
        const rows = await run(`insert into run_log (status, trigger, started_at) values ('running', $1, $2) returning ${RUN_COLS}`, [trigger, now.toISOString()]);
        return rows[0] ? toRun(rows[0]) : null;
      } catch (e) {
        if (uniqueViolation(e)) return null; // another run holds the lock
        throw e;
      }
    },
    async finishRun(id, patch) {
      const scalar = ['status', 'finished_at', 'reviewed', 'extracted', 'queued'] as const;
      const jsonCols = ['sources', 'notes'] as const;
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const c of scalar) if (c in patch) { params.push((patch as Record<string, unknown>)[c]); sets.push(`${c} = $${params.length}`); }
      for (const c of jsonCols) if (c in patch) { params.push(json((patch as Record<string, unknown>)[c])); sets.push(`${c} = $${params.length}::jsonb`); }
      if (sets.length) await run(`update run_log set ${sets.join(', ')} where id = $1::uuid`, params);
    },
    async listRuns(limit) {
      const rows = await run(`select ${RUN_COLS} from run_log order by started_at desc limit $1`, [limit]);
      return rows.map(toRun);
    },
  };
}
