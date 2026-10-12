import type { Article, Company, DigestRow, DraftRow, EventRow, RunRow, Settings } from '../types';

export interface Repo {
  readonly kind: 'neon' | 'memory';
  /** true when data does not persist (no database connected) */
  readonly demo: boolean;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;

  listCompanies(): Promise<Company[]>;
  upsertCompany(c: Company): Promise<void>;
  deleteCompany(key: string): Promise<void>;

  /** Articles first seen on or after `sinceIso`. */
  listArticles(sinceIso: string): Promise<Article[]>;
  /** Inserts new articles only; existing ids are left untouched (first_seen_at stays). Returns the number inserted. */
  insertNewArticles(a: Article[]): Promise<number>;
  saveExtraction(id: string, extraction: Article['extraction'], attempts: number, text?: { text: string; kind: Article['text_kind'] }): Promise<void>;

  listEvents(): Promise<EventRow[]>;
  addEvent(e: Omit<EventRow, 'id'>): Promise<void>;

  getDraft(clusterId: string): Promise<DraftRow | null>;
  saveDraft(d: DraftRow): Promise<void>;

  getDigest(recipient: string, weekStart: string): Promise<DigestRow | null>;
  /** Creates the digest row for (recipient, week). Returns null when one already exists (unique key). */
  createDigest(d: Omit<DigestRow, 'id'>): Promise<DigestRow | null>;
  updateDigest(id: string, patch: Partial<DigestRow>): Promise<void>;

  /** Starts a run if none is running (or the running one is older than ttl). Returns null when locked. */
  startRun(trigger: RunRow['trigger'], ttlMinutes: number, now: Date): Promise<RunRow | null>;
  finishRun(id: string, patch: Partial<RunRow>): Promise<void>;
  listRuns(limit: number): Promise<RunRow[]>;
}
