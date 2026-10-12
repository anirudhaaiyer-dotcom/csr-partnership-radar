export type Tri = 'passed' | 'failed' | 'unknown';

export type SignalLevel = 'partner_search' | 'initiative_budget' | 'allocation' | 'policy' | 'none';
export type BeneficiaryLevel = 'dropouts_first_gen' | 'low_income_youth' | 'youth_general' | 'none';
export type SectorLevel = 'skilling_placement' | 'digital_youth_employment' | 'other_education' | 'none';
export type GeographyLevel = 'pune' | 'maharashtra' | 'pan_india' | 'base_maharashtra' | 'other';
export type SourceClass = 'official' | 'major_press' | 'regional_trade' | 'blog';

/** quoted = value backed by an exact quote found in the stored text.
 *  not_stated = nothing usable. list = value comes from the company list Ananya maintains.
 *  metadata = taken from feed metadata (published date, publisher). */
export type Tag = 'quoted' | 'not_stated' | 'list' | 'metadata';

export interface Field<T> {
  value: T | null;
  quote: string | null;
  tag: 'quoted' | 'not_stated';
}

export interface Extraction {
  company: Field<string>;
  signal: Field<SignalLevel>;
  explicit_partner_search: Field<boolean>;
  beneficiary: Field<BeneficiaryLevel>;
  sector: Field<SectorLevel>;
  geography: Field<GeographyLevel>;
  scale_cr: Field<number>;
  deadline: Field<string>; // ISO date yyyy-mm-dd
  contact: Field<string>;
  foundation: Field<string>;
  apply_link: Field<string>;
  schedule_vii: Field<'fits' | 'not_fits'>;
  rejected_quotes: string[]; // field names whose quote was not found in the text
  extracted_by: string; // model name or 'seed-manual'
}

export interface Article {
  id: string; // sha1 of normalised url
  url: string;
  title: string;
  publisher: string | null;
  publisher_domain: string | null;
  published_at: string | null; // ISO
  first_seen_at: string; // ISO
  source: 'google_news' | 'bing_news' | 'gdelt' | 'seed';
  text: string; // title + snippet or fetched body text
  text_kind: 'snippet_only' | 'body';
  extraction: Extraction | null;
  extraction_attempts: number;
}

export type TriCheck = { state: Tri; reason: string; evidence?: string | null };

export interface Company {
  key: string; // normalised name
  name: string;
  section135: Tri;
  checked_on: string | null;
  source_checked: string | null;
  relationship: boolean;
  hq_maharashtra: boolean;
  excluded: boolean;
  excluded_reason: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_how: string | null;
}

export interface Settings {
  call_min: number;
  watch_min: number;
  fit_floor: number;
  late_min_fresh_score: number;
  late_max: number;
  main_window_days: number;
  discovery_window_days: number;
  stale_after_days: number;
  queries: string[];
  excluded_keywords: string[];
  sectors: string[];
  readiness: {
    csr1: Tri;
    reg12a: Tri;
    g80_valid_until: string | null;
    record_years: number | null;
  };
  digest_to: string | null;
  /** Points for each geography level (the NGO's footprint). Defaults match the rubric; editable in Settings. */
  geo_points: Record<'pune' | 'maharashtra' | 'pan_india' | 'base_maharashtra', number>;
}

export type Verdict = 'call' | 'watch' | 'skip' | 'excluded' | 'policy';
export type Confidence = 'high' | 'medium' | 'low';

export interface FactorScore {
  key: 'signal' | 'beneficiary' | 'sector' | 'geography' | 'scale' | 'recency' | 'source' | 'actionability' | 'corroboration' | 'capacity';
  label: string;
  points: number;
  max: number;
  tag: Tag;
  quote: string | null;
  note: string | null;
}

export interface ArticleRef {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  published_at: string | null;
  source_class: SourceClass;
}

export interface Opportunity {
  id: string; // cluster id
  company: string;
  company_key: string;
  signal_type: SignalLevel;
  verdict: Verdict;
  verdict_reason: string;
  total: number | null;
  fresh_total: number | null;
  factors: FactorScore[];
  checks: { schedule_vii: TriCheck; section135: TriCheck; exclusions: TriCheck };
  confidence: Confidence;
  supported_fields: number;
  geography: GeographyLevel;
  geography_tag: Tag;
  published_at: string | null;
  first_seen_at: string;
  last_updated_at: string;
  deadline: string | null;
  deadline_history: { from: string; to: string; at: string }[];
  age_days: number | null;
  closing_before_next_monday: boolean;
  is_open_call: boolean;
  relationship: boolean;
  contact: string | null;
  why_matters: string;
  why_now: string;
  next_action: string;
  sources: ArticleRef[];
  shown_before: boolean;
  dismissed: boolean;
  pursued: boolean;
  late_find: boolean;
  fresh_verdict: Verdict;
}

export interface EventRow {
  id: string;
  cluster_id: string;
  kind: 'shown' | 'pursue' | 'not_for_us' | 'undo_not_for_us' | 'relevance' | 'status' | 'duplicate' | 'wrong_info' | 'opened' | 'draft_copied' | 'not_duplicate';
  payload: Record<string, unknown> | null;
  at: string;
}

export interface DraftRow {
  cluster_id: string;
  subject: string;
  body: string;
  model: string;
  warnings: string[];
  created_at: string;
}

export interface DigestRow {
  id: string;
  recipient: string;
  week_start: string; // yyyy-mm-dd (Monday, IST)
  status: 'pending' | 'sent' | 'failed';
  variant: 'normal' | 'nothing' | 'failed' | 'delayed';
  resend_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface SourceStat {
  source: string;
  ok: boolean;
  items: number;
  error_class: string | null;
  detail?: string;
}

export interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'locked';
  reviewed: number;
  extracted: number;
  queued: number;
  sources: SourceStat[];
  notes: string[];
  trigger: 'cron' | 'manual' | 'catchup';
}
