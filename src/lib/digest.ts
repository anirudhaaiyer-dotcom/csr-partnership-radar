import { fetchRetry, type FetchLike } from './http';
import { digestCalls, geoLabel, type Lists } from './opportunities';
import { formatDate, weekStartIST } from './time';
import type { DigestRow, EventRow, Opportunity, RunRow } from './types';
import type { Repo } from './repo/types';

export type DigestVariant = DigestRow['variant'];
export interface DigestContent {
  variant: DigestVariant;
  subject: string;
  html: string;
  text: string;
  clusterIds: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const FOLLOW_UP_DAYS = 5;

export interface Activity {
  /** Pursued or drafted at least FOLLOW_UP_DAYS ago, with no status logged since. */
  followUps: { o: Opportunity; days: number }[];
  /** Outreach drafts copied in the last 7 days. */
  outreach: { o: Opportunity; at: string }[];
}

/** Pure: turns the event log into the follow-up reminders and the week's outreach list for the digest. */
export function buildActivity(all: Opportunity[], events: EventRow[], now: Date): Activity {
  const DAY = 86400000;
  const followUps: Activity['followUps'] = [];
  const outreach: Activity['outreach'] = [];
  for (const o of all) {
    if (o.dismissed) continue;
    const ev = events.filter((e) => e.cluster_id === o.id);
    const last = (kind: EventRow['kind']) => ev.filter((e) => e.kind === kind).map((e) => e.at).sort().pop();
    const pursue = last('pursue');
    const copied = last('draft_copied');
    if (copied && now.getTime() - new Date(copied).getTime() <= 7 * DAY) outreach.push({ o, at: copied });
    const touch = [pursue, copied].filter((x): x is string => !!x).sort().pop();
    if (!touch) continue;
    const answered = ev.some((e) => e.kind === 'status' && e.at > touch);
    const days = Math.floor((now.getTime() - new Date(touch).getTime()) / DAY);
    if (!answered && days >= FOLLOW_UP_DAYS) followUps.push({ o, days });
  }
  followUps.sort((a, b) => b.days - a.days);
  return { followUps, outreach };
}

export interface DigestInput {
  lists: Lists;
  now: Date;
  appUrl: string;
  latestRun: RunRow | null;
  lastGoodRunDate: string | null;
  delayed: boolean;
  reviewed: number;
  activity?: Activity;
}

export function buildDigest(i: DigestInput): DigestContent {
  const week = formatDate(weekStartIST(i.now));
  const calls = digestCalls(i.lists);
  const closing = i.lists.closing;
  const failed = i.latestRun?.status === 'failed';
  let variant: DigestVariant = failed ? 'failed' : i.delayed ? 'delayed' : calls.length === 0 && closing.length === 0 ? 'nothing' : 'normal';
  if (!failed && calls.length === 0 && closing.length === 0) variant = i.delayed ? 'delayed' : 'nothing';

  let status: string;
  if (failed) status = `This week's run did not finish. Last successful run: ${i.lastGoodRunDate ? formatDate(i.lastGoodRunDate) : 'none yet'}. Nothing below is from this week.`;
  else if (calls.length === 0 && closing.length === 0) status = `Run completed. ${i.reviewed} items reviewed, none reached Call this week.${(i.lists.emerging ?? []).length ? ` ${(i.lists.emerging ?? []).length} emerging item${(i.lists.emerging ?? []).length === 1 ? '' : 's'} to keep an eye on.` : ''}`;
  else status = `${calls.length} to call this week${closing.length ? `, ${closing.length} closing before next Monday` : ''}.`;
  const fu = i.activity?.followUps ?? [];
  if (!failed && fu.length) status += ` ${fu.length} follow-up${fu.length === 1 ? '' : 's'} due.`;
  if (i.delayed) status = `Delayed digest: the Monday send did not go out. ${status}`;

  const ids = new Set<string>();
  const line = (o: Opportunity, withScore = true) => {
    ids.add(o.id);
    return { o, withScore };
  };
  const closingRows = failed ? [] : closing.map((o) => line(o, false));
  const callRows = failed ? [] : calls.map((o) => line(o));
  const fuDays = new Map(fu.map((f) => [f.o.id, f.days]));
  const fuRows = failed ? [] : fu.map((f) => ({ o: f.o }));
  const outreach = failed ? [] : i.activity?.outreach ?? [];
  const lateRows = failed ? [] : i.lists.late.map((o) => line(o));
  const emerging = failed ? [] : (i.lists.emerging ?? []).slice(0, 5);

  const card = (o: Opportunity, tag: string) => {
    const unknown = o.checks.section135.state === 'unknown' ? ' · Section 135: Unknown' : '';
    return `<tr><td style="padding:12px 0;border-top:1px solid #e5e2da">
<div style="font-size:12px;color:#5d6675">${esc(tag)}${o.relationship ? ' · Existing relationship' : ''}</div>
<div style="font-size:16px;font-weight:600;color:#1b2333">${esc(o.company)}</div>
<div style="font-size:14px;color:#1b2333;margin-top:2px">${esc(o.why_matters)}</div>
<div style="font-size:14px;color:#505a6b;margin-top:2px">${esc(o.why_now)} · ${o.total ?? o.fresh_total ?? ''}/100 · Evidence: ${o.confidence}${esc(unknown)}</div>
<div style="font-size:14px;margin-top:6px;padding:6px 8px;background:#f6f3ec"><b>Next:</b> ${esc(o.next_action)}</div>
<div style="font-size:12px;margin-top:4px"><a href="${esc(i.appUrl)}" style="color:#1f3a5f">${esc(o.sources[0]?.publisher ?? 'Source')}</a>: ${esc(o.sources[0]?.title ?? '')}</div>
</td></tr>`;
  };
  const section = (title: string, rows: { o: Opportunity }[], tag: (o: Opportunity) => string) =>
    rows.length ? `<tr><td style="padding-top:18px;font-size:13px;font-weight:700;color:#1f3a5f;text-transform:uppercase;letter-spacing:.04em">${esc(title)}</td></tr>${rows.map((r) => card(r.o, tag(r.o))).join('')}` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ec;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fffdf8;border:1px solid #e5e2da;padding:20px;max-width:600px">
<tr><td style="font-size:13px;color:#5d6675">CSR Partnership Radar · Week of ${esc(week)}</td></tr>
<tr><td style="font-size:18px;font-weight:650;color:#1b2333;padding-top:6px">${esc(status)}</td></tr>
${section('Follow-ups due', fuRows, (o) => `Pursued ${fuDays.get(o.id)} days ago, no status logged`)}
${section('Closing before next Monday', closingRows, (o) => `Closes ${formatDate(o.deadline)} · ${o.verdict === 'call' ? 'Call this week' : 'Watch'}`)}
${section('Call this week', callRows, () => 'Call this week')}
${section('Late finds', lateRows, (o) => `Late find · published ${formatDate(o.published_at)}`)}
${emerging.length ? `<tr><td style="padding-top:18px;font-size:13px;font-weight:700;color:#1f3a5f;text-transform:uppercase;letter-spacing:.04em">Emerging, not yet a call</td></tr>${emerging.map((o) => `<tr><td style="padding:8px 0;border-top:1px solid #e5e2da;font-size:14px;color:#1b2333"><b>${esc(o.company)}</b> · ${o.total ?? ''}/100<div style="font-size:12px;color:#5d6675">${esc(o.why_now)} · <a href="${esc(o.sources[0]?.url ?? i.appUrl)}" style="color:#1f3a5f">${esc(o.sources[0]?.publisher ?? 'Source')}</a>: ${esc(o.sources[0]?.title ?? '')}</div></td></tr>`).join('')}` : ''}
${outreach.length ? `<tr><td style="padding-top:18px;font-size:13px;font-weight:700;color:#1f3a5f;text-transform:uppercase;letter-spacing:.04em">Outreach you copied this week</td></tr><tr><td style="font-size:14px;color:#1b2333;padding-top:6px">${outreach.map((x) => `${esc(x.o.company)} (${esc(formatDate(x.at))})`).join(' · ')}</td></tr>` : ''}
<tr><td style="padding-top:18px;font-size:13px;color:#505a6b">${failed ? '' : `Watch: ${i.lists.watch.length} · Emerging: ${(i.lists.emerging ?? []).length} · Policy updates: ${i.lists.policy.length}. `}<a href="${esc(i.appUrl)}" style="color:#1f3a5f">Open the workspace</a> for evidence, drafts and the full list. This email never contacts anyone.</td></tr>
<tr><td style="padding-top:12px;font-size:13px;color:#1b2333;background:#f6f3ec;padding:8px"><b>Reminder:</b> open the dashboard this week to review the list, copy a draft, and log what happened with each company you contacted.</td></tr>
</table></td></tr></table></body></html>`;

  const t = (rows: { o: Opportunity }[], title: string) =>
    rows.length ? `\n${title.toUpperCase()}\n` + rows.map(({ o }) => `- ${o.company}: ${o.why_matters}\n  ${o.why_now}. Evidence: ${o.confidence}.\n  Next: ${o.next_action}`).join('\n') + '\n' : '';
  const text = `CSR Partnership Radar, week of ${week}\n${status}\n${t(closingRows, 'Closing before next Monday')}${t(callRows, 'Call this week')}${t(lateRows, 'Late finds')}${emerging.length ? `\nEMERGING, NOT YET A CALL\n` + emerging.map((o) => `- ${o.company} (${o.total ?? ''}/100): ${o.why_now}. ${o.sources[0]?.publisher ?? 'Source'}: ${o.sources[0]?.title ?? ''}`).join('\n') + '\n' : ''}${fu.length && !failed ? `\nFOLLOW-UPS DUE\n` + fu.map((f) => `- ${f.o.company}: pursued ${f.days} days ago, no status logged`).join('\n') + '\n' : ''}${outreach.length ? `\nOUTREACH YOU COPIED THIS WEEK\n` + outreach.map((x) => `- ${x.o.company} (${formatDate(x.at)})`).join('\n') + '\n' : ''}\n${failed ? '' : `Watch: ${i.lists.watch.length}. Policy updates: ${i.lists.policy.length}.\n`}Workspace: ${i.appUrl}\nReminder: open the dashboard this week to review the list, copy a draft, and log what happened with each company you contacted.\nThis email never contacts anyone.`;

  const subject = failed ? `CSR Radar: this week's run did not finish (${week})` : calls.length ? `CSR Radar: ${calls.length} to call this week (${week})` : `CSR Radar: nothing to call this week (${week})`;
  const subjectFinal = !failed && fu.length ? `${subject.replace(` (${week})`, '')}, ${fu.length} follow-up${fu.length === 1 ? '' : 's'} (${week})` : subject;
  return { variant, subject: i.delayed ? `Delayed: ${subjectFinal}` : subjectFinal, html, text, clusterIds: [...ids] };
}

export interface SendDeps {
  repo: Repo;
  resendKey: string | undefined;
  from: string | undefined;
  to: string | undefined;
  fetchImpl?: FetchLike;
  now: Date;
}

export type SendResult =
  | { status: 'sent'; resendId: string | null }
  | { status: 'already_sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/**
 * The only place in the code base that sends email. One digest per recipient per week:
 * the database enforces it with a unique key, and Resend gets the same Idempotency-Key on every retry.
 */
export async function sendDigest(deps: SendDeps, content: DigestContent): Promise<SendResult> {
  const { repo, resendKey, from, to, now } = deps;
  if (!resendKey || !from || !to) return { status: 'skipped', reason: 'RESEND_API_KEY, DIGEST_FROM or DIGEST_TO is not set' };
  const week = weekStartIST(now);
  let row = await repo.getDigest(to, week);
  if (row?.status === 'sent') return { status: 'already_sent' };
  if (!row) {
    row = await repo.createDigest({ recipient: to, week_start: week, status: 'pending', variant: content.variant, resend_id: null, error: null, created_at: now.toISOString(), sent_at: null });
    if (!row) {
      row = await repo.getDigest(to, week);
      if (!row || row.status === 'sent') return { status: 'already_sent' };
    }
  }
  try {
    const res = await fetchRetry(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', 'idempotency-key': `digest-${to}-${week}`.slice(0, 256) },
        body: JSON.stringify({ from, to: [to], subject: content.subject, html: content.html, text: content.text }),
        timeoutMs: 15000,
        retries: 1,
      },
      deps.fetchImpl,
    );
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend returned ${res.status}${body.message ? `: ${body.message}` : ''}`);
    await repo.updateDigest(row.id, { status: 'sent', resend_id: body.id ?? null, sent_at: new Date().toISOString(), error: null, variant: content.variant });
    for (const id of content.clusterIds) await repo.addEvent({ cluster_id: id, kind: 'shown', payload: { via: 'digest', week }, at: now.toISOString() });
    return { status: 'sent', resendId: body.id ?? null };
  } catch (e) {
    await repo.updateDigest(row.id, { status: 'failed', error: (e as Error).message });
    return { status: 'failed', error: (e as Error).message };
  }
}

/** One-off test copy of a digest, marked [TEST]. Does not touch the digests table, so it never blocks the real weekly send. */
export async function sendTestDigest(deps: Omit<SendDeps, 'repo'>, content: DigestContent): Promise<{ ok: true; id: string | null } | { ok: false; status: number; error: string }> {
  const { resendKey, from, to } = deps;
  if (!resendKey || !from || !to) return { ok: false, status: 400, error: 'RESEND_API_KEY, DIGEST_FROM or DIGEST_TO is not set' };
  const res = await fetchRetry(
    'https://api.resend.com/emails',
    { method: 'POST', headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject: `[TEST] ${content.subject}`, html: content.html, text: content.text }), timeoutMs: 15000, retries: 0 },
    deps.fetchImpl,
  );
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) return { ok: false, status: res.status, error: body.message ?? 'Resend rejected the request' };
  return { ok: true, id: body.id ?? null };
}

export { geoLabel };
