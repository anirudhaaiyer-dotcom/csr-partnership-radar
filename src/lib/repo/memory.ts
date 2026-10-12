import { DEFAULT_SETTINGS } from '../config';
import { loadSeedArticles } from '../seed';
import type { Article, Company, DigestRow, DraftRow, EventRow, RunRow, Settings } from '../types';
import type { Repo } from './types';

let counter = 0;
const nid = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** In-process store. Used for tests and for demo mode when no database is connected. Nothing persists across restarts. */
export function createMemoryRepo(opts: { seed?: boolean; demo?: boolean } = {}): Repo {
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const companies = new Map<string, Company>();
  const articles = new Map<string, Article>();
  const events: EventRow[] = [];
  const drafts = new Map<string, DraftRow>();
  const digests: DigestRow[] = [];
  const runs: RunRow[] = [];
  if (opts.seed) for (const a of loadSeedArticles()) articles.set(a.id, a);

  return {
    kind: 'memory',
    demo: opts.demo ?? true,
    async getSettings() { return structuredClone(settings); },
    async saveSettings(s) { settings = structuredClone(s); },
    async listCompanies() { return [...companies.values()].map((c) => structuredClone(c)); },
    async upsertCompany(c) { companies.set(c.key, structuredClone(c)); },
    async deleteCompany(key) { companies.delete(key); },
    async listArticles(sinceIso) { return [...articles.values()].filter((a) => a.first_seen_at >= sinceIso).map((a) => structuredClone(a)); },
    async insertNewArticles(list) {
      let n = 0;
      for (const a of list) if (!articles.has(a.id)) { articles.set(a.id, structuredClone(a)); n++; }
      return n;
    },
    async saveExtraction(id, extraction, attempts, text) {
      const a = articles.get(id);
      if (!a) return;
      a.extraction = extraction; a.extraction_attempts = attempts;
      if (text) { a.text = text.text; a.text_kind = text.kind; }
    },
    async listEvents() { return events.map((e) => ({ ...e })); },
    async addEvent(e) { events.push({ ...e, id: nid() }); },
    async getDraft(id) { return drafts.get(id) ?? null; },
    async saveDraft(d) { drafts.set(d.cluster_id, structuredClone(d)); },
    async getDigest(recipient, week) { return digests.find((d) => d.recipient === recipient && d.week_start === week) ?? null; },
    async createDigest(d) {
      if (digests.some((x) => x.recipient === d.recipient && x.week_start === d.week_start)) return null; // unique key
      const row = { ...d, id: nid() };
      digests.push(row);
      return { ...row };
    },
    async updateDigest(id, patch) { const d = digests.find((x) => x.id === id); if (d) Object.assign(d, patch); },
    async startRun(trigger, ttl, now) {
      const live = runs.find((r) => r.status === 'running');
      if (live) {
        const age = now.getTime() - Date.parse(live.started_at);
        if (age < ttl * 60000) return null;
        live.status = 'failed'; live.finished_at = now.toISOString(); live.notes.push('Marked failed: lock expired');
      }
      const row: RunRow = { id: nid(), started_at: now.toISOString(), finished_at: null, status: 'running', reviewed: 0, extracted: 0, queued: 0, sources: [], notes: [], trigger };
      runs.push(row);
      return structuredClone(row);
    },
    async finishRun(id, patch) { const r = runs.find((x) => x.id === id); if (r) Object.assign(r, patch); },
    async listRuns(limit) { return runs.slice(-limit).reverse().map((r) => structuredClone(r)); },
  };
}
