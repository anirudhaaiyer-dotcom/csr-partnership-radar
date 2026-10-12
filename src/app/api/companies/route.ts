import { checkWrite } from '@/lib/auth';
import { repo } from '@/lib/server';
import { isIsoDate } from '@/lib/time';
import { normalizeCompany } from '@/lib/util';
import type { Company, Tri } from '@/lib/types';

export const dynamic = 'force-dynamic';
const TRI: Tri[] = ['passed', 'failed', 'unknown'];
const s = (v: unknown, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export async function POST(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = s(b.name);
  if (!name) return Response.json({ error: 'Company name is required' }, { status: 400 });
  const section135 = TRI.includes(b.section135 as Tri) ? (b.section135 as Tri) : 'unknown';
  const checked = s(b.checked_on, 10);
  if (checked && !isIsoDate(checked)) return Response.json({ error: 'Checked on must be a date like 2026-10-12' }, { status: 400 });
  if (section135 !== 'unknown' && !checked) return Response.json({ error: 'Add the date you checked, so the status can be trusted later' }, { status: 400 });
  const c: Company = {
    key: normalizeCompany(name), name, section135, checked_on: checked, source_checked: s(b.source_checked),
    relationship: !!b.relationship, hq_maharashtra: !!b.hq_maharashtra, excluded: !!b.excluded, excluded_reason: s(b.excluded_reason),
    contact_name: s(b.contact_name), contact_role: s(b.contact_role), contact_how: s(b.contact_how),
  };
  await repo().upsertCompany(c);
  return Response.json({ ok: true, company: c });
}

export async function DELETE(req: Request) {
  const denied = checkWrite(req);
  if (denied) return denied;
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return Response.json({ error: 'key is required' }, { status: 400 });
  await repo().deleteCompany(key);
  return Response.json({ ok: true });
}
