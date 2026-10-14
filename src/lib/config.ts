import type { Settings } from './types';

/** Rubric v3 (12 Oct 2026, 100 points, 10 factors). v3 recalibrated the bars to Call 55 / Watch 30 and added corroboration and capacity by trimming beneficiary, geography, scale and recency. */
export const RUBRIC = {
  signal: { partner_search: 25, initiative_budget: 18, allocation: 12, policy: 0, none: 0 },
  beneficiary: { dropouts_first_gen: 18, low_income_youth: 11, youth_general: 5, none: 0 },
  sector: { skilling_placement: 10, digital_youth_employment: 8, other_education: 4, none: 0 },
  geography: { pune: 13, maharashtra: 10, pan_india: 8, base_maharashtra: 5, other: 0 },
  scaleBands: [
    { minCr: 10, points: 8 },
    { minCr: 5, points: 6 },
    { minCr: 1, points: 4 },
  ],
  scaleUnder1: 2,
  scaleUnstated: 3,
  recency: [
    { maxAge: 2, points: 8 },
    { maxAge: 4, points: 6 },
    { maxAge: 7, points: 3 },
  ],
  source: { official: 5, major_press: 4, regional_trade: 3, blog: 1 },
  actionability: { named: 5, foundation: 3, none: 0 },
  /** v3: how many separate publishers covered the same story (a lone headline is weaker than a story several outlets ran). */
  corroboration: { three_plus: 4, two: 2, one: 0 },
  /** v3: the company's ability to fund. Section 135 status comes from the Companies list; unlisted counts as a small neutral amount. */
  capacity: { passed: 4, unknown: 1, failed: 0 },
  max: { signal: 25, beneficiary: 18, sector: 10, geography: 13, scale: 8, recency: 8, source: 5, actionability: 5, corroboration: 4, capacity: 4 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  call_min: 55,
  watch_min: 30,
  fit_floor: 6,
  geo_points: { pune: 13, maharashtra: 10, pan_india: 8, base_maharashtra: 5 },
  late_min_fresh_score: 65,
  late_max: 3,
  main_window_days: 7,
  discovery_window_days: 21,
  stale_after_days: 8,
  queries: [
    '"CSR" (education OR skilling OR "skill development") India',
    '"CSR" "digital literacy" youth India',
    '"CSR" "youth employment" OR "livelihood" India',
    '"CSR" Pune OR Maharashtra education skilling',
    '"CSR" "school dropouts" OR "first-generation" India',
    '"CSR" "request for proposal" OR "call for proposals" OR "expression of interest" education',
  ],
  excluded_keywords: [],
  sectors: ['Education', 'Skill development', 'Digital literacy', 'Youth employment'],
  readiness: { csr1: 'unknown', reg12a: 'unknown', g80_valid_until: null, record_years: null },
  digest_to: null,
};

export const EXTRACT_BATCH = 4;
export const MAX_EXTRACT_PER_RUN = 40;
/** Of those, at most this many are earlier headline-only items re-read on the full article. */
export const MAX_UPGRADE_PER_RUN = 20;
export const MAX_DIGEST_CALLS = 10;
/** Skip-verdict items at or above this score are shown as Emerging: real activity in the NGO's space, but not yet a reason to call. */
export const EMERGING_MIN = 15;
export const MAX_EMERGING = 8;
export const LOCK_TTL_MINUTES = 15;

/** Publisher classification. Anything not listed is regional_trade (3); known blog platforms are blog (1). */
export const MAJOR_PRESS = [
  'economictimes.indiatimes.com', 'timesofindia.indiatimes.com', 'livemint.com', 'business-standard.com',
  'thehindu.com', 'thehindubusinessline.com', 'hindustantimes.com', 'indianexpress.com', 'financialexpress.com',
  'moneycontrol.com', 'ndtv.com', 'reuters.com', 'bloomberg.com', 'pti.in', 'ptinews.com', 'ani.in',
  'cnbctv18.com', 'theprint.in', 'scroll.in', 'firstpost.com', 'deccanherald.com', 'telegraphindia.com',
];
export const OFFICIAL_WIRES = ['prnewswire.com', 'businesswire.com', 'pib.gov.in', 'globenewswire.com', 'newsroom.', 'investor.'];
export const BLOG_PLATFORMS = ['medium.com', 'blogspot.com', 'wordpress.com', 'substack.com', 'tumblr.com', 'linkedin.com'];
