'use client';

import { useState } from 'react';
import type { DraftRow, Opportunity } from '@/lib/types';
import { formatDate } from '@/lib/time';

const GEO: Record<string, string> = { pune: 'Pune', maharashtra: 'Maharashtra', pan_india: 'Pan-India', base_maharashtra: 'Company base in Maharashtra', other: 'Other' };
const SIGNAL: Record<string, string> = { partner_search: 'Partner search', initiative_budget: 'New initiative with budget', allocation: 'CSR initiative or allocation', policy: 'Policy update', none: 'Unclear' };
const TAG: Record<string, string> = { quoted: 'quoted', not_stated: 'not stated', list: 'from your list', metadata: 'from feed data' };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as Record<string, unknown>;
}

export function OpportunityCard({ o, initialDraft, writable }: { o: Opportunity; initialDraft: DraftRow | null; writable: boolean }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(o.dismissed);
  const [pursued, setPursued] = useState(o.pursued);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [body, setBody] = useState(initialDraft?.body ?? '');
  const [warnings, setWarnings] = useState<string[]>(initialDraft?.warnings ?? []);
  const [copied, setCopied] = useState(false);

  const kind = o.verdict === 'call' ? 'call' : o.verdict === 'watch' ? 'watch' : 'policy';
  const scored = o.verdict !== 'policy';
  const label = o.late_find ? 'Late find' : o.verdict === 'call' ? 'Call this week' : o.verdict === 'watch' ? 'Watch' : o.verdict === 'policy' ? 'Policy update' : 'Excluded';
  const chipClass = o.verdict === 'call' ? 'call' : o.verdict === 'watch' ? 'watch' : 'pol';
  const total = o.total ?? o.fresh_total;

  async function act(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (dismissed) {
    return (
      <div className="done" role="status">
        <span>Marked not for us: {o.company}.</span>
        <select className="f" aria-label="Reason (optional)" style={{ maxWidth: 260 }} defaultValue="" onChange={(e) => e.target.value && act(async () => { await post('/api/event', { id: o.id, kind: 'relevance', payload: { relevant: false, reason: e.target.value } }); })}>
          <option value="">Reason (optional)…</option>
          {['Wrong geography', 'Wrong beneficiary', 'Not a funder', 'Already known', 'Expired'].map((r) => <option key={r}>{r}</option>)}
        </select>
        <button className="btn" type="button" disabled={!writable || busy} onClick={() => act(async () => { await post('/api/event', { id: o.id, kind: 'undo_not_for_us' }); setDismissed(false); })}>Undo</button>
        {err && <span className="err">{err}</span>}
      </div>
    );
  }

  return (
    <article className={`card ${kind}`} aria-labelledby={`t-${o.id}`}>
      <div className="row">
        <span className={`chip ${chipClass}`}>{label}</span>
        {o.relationship && <span className="chip warm">Existing relationship</span>}
        {o.checks.section135.state === 'unknown' && scored && <span className="chip unk">Section 135: Unknown</span>}
        {scored && total !== null && (
          <span className="score"><b>{total}</b> / 100<br />Evidence: {o.confidence} · {o.supported_fields} of 8 supported</span>
        )}
      </div>
      <h3 id={`t-${o.id}`}>{o.company}</h3>
      <p style={{ margin: '4px 0' }}><b>Why it matters:</b> {o.why_matters}</p>
      <p style={{ margin: '2px 0' }}><b>Why now:</b> {o.why_now}</p>
      <div className="next"><b>Next action:</b> {o.next_action}</div>
      <div className="btns">
        {scored && (
          <>
            <button className="btn primary" type="button" disabled={!writable || busy} title={writable ? '' : 'Changes are disabled until APP_PASSWORD is set'}
              aria-expanded={pursued}
              onClick={() => act(async () => {
                const d = (await post('/api/pursue', { id: o.id })) as { draft: DraftRow | null; error: string | null };
                setPursued(true);
                if (d.draft) { setSubject(d.draft.subject); setBody(d.draft.body); setWarnings(d.draft.warnings); }
                if (d.error) setNote(d.error);
              })}>
              {busy ? 'Working…' : pursued ? 'Draft shown below' : 'Pursue (creates a draft email)'}
            </button>
            <button className="btn" type="button" disabled={!writable || busy} onClick={() => act(async () => { await post('/api/event', { id: o.id, kind: 'not_for_us' }); setDismissed(true); })}>Not for us</button>
          </>
        )}
        <button className="btn" type="button" aria-expanded={open} aria-controls={`p-${o.id}`}
          onClick={() => { setOpen(!open); if (!open && writable) post('/api/event', { id: o.id, kind: 'opened' }).catch(() => {}); }}>
          {open ? 'Hide evidence' : 'Open evidence'}
        </button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}

      {pursued && (
        <div className="draft" role="group" aria-label="Draft email">
          <div className="row"><b>Draft email</b><span className="chip">Draft, not sent</span></div>
          {note && <p className="err">{note}</p>}
          {warnings.map((w) => <p className="err" key={w}>{w}</p>)}
          <label htmlFor={`sb-${o.id}`}>Subject</label>
          <input type="text" id={`sb-${o.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => writable && (subject || body) && post('/api/draft', { id: o.id, subject, body }).catch(() => {})} style={{ maxWidth: '100%' }} />
          <label htmlFor={`bd-${o.id}`}>Message</label>
          <textarea id={`bd-${o.id}`} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => writable && (subject || body) && post('/api/draft', { id: o.id, subject, body }).catch(() => {})} />
          <div className="btns">
            <button className="btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); writable && post('/api/event', { id: o.id, kind: 'draft_copied' }).catch(() => {}); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</button>
            <a className="btn" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in my mail app</a>
          </div>
          <p className="meta" style={{ margin: '8px 0 0' }}>This tool never sends email. You send it from your own mail app.</p>
        </div>
      )}

      <div className="panel" id={`p-${o.id}`} hidden={!open}>
        <h4>At a glance</h4>
        <p>
          {SIGNAL[o.signal_type]} · {GEO[o.geography]} ({TAG[o.geography_tag]}) · Published {o.published_at ? formatDate(o.published_at) : 'date not given'} · First seen {formatDate(o.first_seen_at)} · Deadline {o.deadline ? formatDate(o.deadline) : 'none stated'}
          {o.deadline_history.length > 0 && <><br />Deadline changed: {o.deadline_history.map((h) => `${formatDate(h.from)} to ${formatDate(h.to)}`).join('; ')}</>}
        </p>
        <p className="meta">{o.verdict_reason}.</p>

        {scored && (
          <>
            <h4>1. Why this verdict</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Factor</th><th>Points</th><th>Supporting quote</th><th>Tag</th></tr></thead>
                <tbody>
                  {o.factors.map((f) => (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td>{f.points} of {f.max}</td>
                      <td>{f.quote ? <span className="quote">“{f.quote}”</span> : <span className="meta">{f.note}</span>}</td>
                      <td><span className={`tagchip ${f.tag}`}>{TAG[f.tag]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4>2. Checks</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Check</th><th>State</th><th>Reason</th></tr></thead>
                <tbody>
                  {([['Schedule VII fit', o.checks.schedule_vii], ['Company Section 135 applicability', o.checks.section135], ['Exclusions', o.checks.exclusions]] as const).map(([n, c]) => (
                    <tr key={n}>
                      <td>{n}</td>
                      <td><span className={`chip ${c.state === 'unknown' ? 'unk' : c.state === 'passed' ? 'call' : ''}`}>{c.state[0].toUpperCase() + c.state.slice(1)}</span></td>
                      <td>{c.reason}{c.evidence ? <><br /><span className="quote">“{c.evidence}”</span></> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h4>{scored ? '3' : '1'}. Sources and freshness</h4>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
          {o.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> · {s.publisher ?? 'publisher unknown'} · {s.source_class.replace('_', ' ')} · {s.published_at ? formatDate(s.published_at) : 'no date'}
            </li>
          ))}
        </ul>
        <p className="meta">Merged sources: {o.sources.length} · Last updated {formatDate(o.last_updated_at)}</p>

        {scored && (
          <>
            <h4>4. Contact</h4>
            <p>{o.contact ?? <i>No contact added. Add one on the Companies screen.</i>}</p>
            <h4>5. Record outcome</h4>
            <div className="row">
              <select className="f" aria-label="Outreach status" disabled={!writable} defaultValue="" onChange={(e) => e.target.value && act(async () => { await post('/api/event', { id: o.id, kind: 'status', payload: { status: e.target.value } }); })}>
                <option value="">Outreach status…</option>
                {['Not started', 'Drafted', 'Sent by me', 'Replied', 'Meeting held', 'Proposal invited', 'Declined'].map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className="f" aria-label="Data problem" disabled={!writable} defaultValue="" onChange={(e) => e.target.value && act(async () => { await post('/api/event', { id: o.id, kind: e.target.value === 'Duplicate' ? 'duplicate' : 'wrong_info' }); })}>
                <option value="">Data problem…</option>
                <option>Duplicate</option>
                <option>Wrong information</option>
              </select>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
