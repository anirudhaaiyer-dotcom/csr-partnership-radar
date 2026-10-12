import { checkWrite } from '@/lib/auth';
import { repo } from '@/lib/server';
import { isIsoDate } from '@/lib/time';
import type { Settings, Tri } from '@/lib/types';

export const dynamic = 'force-dynamic';
const TRI: Tri[] = ['passed', 'failed', 'unknown'];
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 200)).slice(0, 50) : null);

export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = repo();
  const cur = await r.getSettings();
  const next: Settings = { ...cur };
  const callMin = num(b.call_min, 1, 100), watchMin = num(b.watch_min, 0, 99), floor = num(b.fit_floor, 0, 20);
  if (callMin !== null) next.call_min = callMin;
  if (watchMin !== null) next.watch_min = watchMin;
  if (floor !== null) next.fit_floor = floor;
  if (next.watch_min >= next.call_min) return Response.json({ error: 'Watch must be lower than Call' }, { status: 400 });
  const ex = list(b.excluded_keywords); if (ex) next.excluded_keywords = ex;
  const sec = list(b.sectors); if (sec) next.sectors = sec;
  const qs = list(b.queries); if (qs && qs.length) next.queries = qs;
  if (typeof b.digest_to === 'string') next.digest_to = b.digest_to.trim() || null;
  const rd = b.readiness as Partial<Settings['readiness']> | undefined;
  if (rd) {
    if (rd.csr1 && TRI.includes(rd.csr1)) next.readiness.csr1 = rd.csr1;
    if (rd.reg12a && TRI.includes(rd.reg12a)) next.readiness.reg12a = rd.reg12a;
    if (rd.g80_valid_until === null || (typeof rd.g80_valid_until === 'string' && isIsoDate(rd.g80_valid_until))) next.readiness.g80_valid_until = rd.g80_valid_until ?? null;
    if (rd.record_years === null || num(rd.record_years, 0, 200) !== null) next.readiness.record_years = rd.record_years ?? null;
  }
  await r.saveSettings(next);
  return Response.json({ ok: true, settings: next });
}
