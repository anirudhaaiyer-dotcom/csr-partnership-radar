const IST_MS = 5.5 * 3600 * 1000;
const DAY = 86400000;

/** IST calendar day number (days since 1970-01-01 in IST). */
export function istDay(d: Date | string | number): number {
  return Math.floor((new Date(d).getTime() + IST_MS) / DAY);
}

export function dayToIso(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function istDateString(d: Date | string | number): string {
  return dayToIso(istDay(d));
}

/** Day number of a yyyy-mm-dd date string. */
export function isoToDay(s: string): number {
  return Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** Whole IST days between publication and now. Same IST day = 0. Never negative. */
export function ageDays(published: string | null | undefined, now: Date): number | null {
  if (!published) return null;
  const t = Date.parse(published);
  if (Number.isNaN(t)) return null;
  return Math.max(0, istDay(now) - istDay(t));
}

/** Weekday in IST, 0 = Sunday. */
export function istWeekday(d: Date | string | number): number {
  return new Date(istDay(d) * DAY).getUTCDay();
}

/** Monday (IST) of the week containing `d`, as yyyy-mm-dd. */
export function weekStartIST(d: Date | string | number): string {
  const day = istDay(d);
  const offset = (istWeekday(d) + 6) % 7;
  return dayToIso(day - offset);
}

/** Day number of the next Monday strictly after today (IST). */
export function nextMondayDay(now: Date): number {
  const dow = istWeekday(now);
  const add = (8 - dow) % 7 || 7;
  return istDay(now) + add;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = iso.length === 10 ? d : new Date(d.getTime() + IST_MS);
  return `${base.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][base.getUTCMonth()]} ${base.getUTCFullYear()}`;
}

export function formatDateTimeIST(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + IST_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(istDateString(t))}, ${hh}:${mm} IST`;
}
