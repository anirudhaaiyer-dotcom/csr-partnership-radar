import { formatDate, istDateString } from './time';
import { normalizeCompany, normalizeText } from './util';
import type { Company, Extraction, Settings, Tri, TriCheck } from './types';

/** Schedule VII fit: the source must describe the activity. Unknown unless the extraction has a verified quote. */
export function checkScheduleVII(ex: Extraction): TriCheck {
  const f = ex.schedule_vii;
  if (f.tag === 'quoted' && f.value === 'fits') {
    return { state: 'passed', reason: 'The source describes an activity in education, vocational skills or livelihood. Confirm the head with your compliance lead.', evidence: f.quote };
  }
  if (f.tag === 'quoted' && f.value === 'not_fits') {
    return { state: 'failed', reason: 'The source describes an activity outside education, skills and livelihood.', evidence: f.quote };
  }
  return { state: 'unknown', reason: 'The source does not describe the activity clearly enough to place it.', evidence: null };
}

/** Company Section 135 applicability: only ever taken from the company list Ananya maintains. */
export function checkSection135(company: Company | null | undefined): TriCheck {
  if (!company) return { state: 'unknown', reason: 'Company is not on your list. Add it with the status you have verified.' };
  if (company.section135 === 'unknown') return { state: 'unknown', reason: 'Listed, but no status set yet.' };
  const when = company.checked_on ? ` on ${formatDate(company.checked_on)}` : '';
  const src = company.source_checked ? ` from ${company.source_checked}` : '';
  return { state: company.section135, reason: `Set by you${when}${src}.` };
}

export function checkExclusions(company: Company | null | undefined, settings: Settings, text: string): TriCheck {
  if (company?.excluded) return { state: 'failed', reason: company.excluded_reason || 'Company is on your exclusion list.' };
  const hay = normalizeText(text);
  const hit = settings.excluded_keywords.map((k) => k.trim()).filter(Boolean).find((k) => hay.includes(normalizeText(k)));
  if (hit) return { state: 'failed', reason: `Matches your exclusion keyword "${hit}".` };
  return { state: 'passed', reason: 'No match in your exclusion list.' };
}

/** NGO readiness: standing check on our own organisation. */
export function checkReadiness(settings: Settings, now: Date): TriCheck {
  const r = settings.readiness;
  const parts: Tri[] = [r.csr1, r.reg12a];
  let g80: Tri = 'unknown';
  if (r.g80_valid_until) g80 = r.g80_valid_until >= istDateString(now) ? 'passed' : 'failed';
  parts.push(g80);
  const yrs: Tri = r.record_years === null ? 'unknown' : r.record_years >= 3 ? 'passed' : 'failed';
  parts.push(yrs);
  if (parts.includes('failed')) return { state: 'failed', reason: 'One of CSR-1, 12A, 80G validity or the 3-year record is not met.' };
  if (parts.every((p) => p === 'passed')) return { state: 'passed', reason: 'CSR-1, 12A, 80G validity and 3-year record set as met.' };
  return { state: 'unknown', reason: 'Some readiness items are not set in Settings yet.' };
}

export const companyMatch = (companies: Company[], name: string | null | undefined): Company | null => {
  if (!name) return null;
  const key = normalizeCompany(name);
  return companies.find((c) => c.key === key) ?? null;
};
