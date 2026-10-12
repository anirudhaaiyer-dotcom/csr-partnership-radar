'use client';

import { useState } from 'react';

type Lead = { company: string; noticed: string; label: string };
type Draft = { subject: string; body: string; short_message: string; warnings: string[]; model: string };
const TONES: [string, string][] = [['warm', 'Warm introduction'], ['direct', 'Short and direct'], ['follow_up', 'Follow-up nudge']];

type Found = { found: boolean; name: string | null; title: string | null; company: string | null; linkedin: string | null; phones: { number: string; kind: string; doNotCall: boolean }[]; emails: { address: string; kind: string; confidence: string | null }[]; creditCharged: boolean; note: string | null };

export function OutreachClient({ leads, companies, writable, lookupOn, initial }: { leads: Lead[]; companies: { name: string; contact: string; role: string }[]; writable: boolean; lookupOn: boolean; initial: { company: string; noticed: string } }) {
  const [company, setCompany] = useState(initial.company);
  const [contact, setContact] = useState('');
  const [role, setRole] = useState('');
  const [noticed, setNoticed] = useState(initial.noticed);
  const [ask, setAsk] = useState('');
  const [tone, setTone] = useState('warm');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [short, setShort] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [linkedin, setLinkedin] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);

  function pickCompany(name: string) {
    setCompany(name);
    const c = companies.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (c) { if (c.contact && !contact) setContact(c.contact); if (c.role && !role) setRole(c.role); }
    const l = leads.find((x) => x.company.toLowerCase() === name.toLowerCase());
    if (l && !noticed) setNoticed(l.noticed);
  }

  async function generate() {
    setBusy(true); setErr(null); setCopied(null);
    try {
      const res = await fetch('/api/outreach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company, contact, role, noticed, ask, tone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      const d = (data as { draft: Draft }).draft;
      setDraft(d); setSubject(d.subject); setBody(d.body); setShort(d.short_message);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function lookup() {
    setLooking(true); setLookErr(null); setFound(null);
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: contact, company, linkedin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      const f = (data as { contact: Found }).contact;
      setFound(f);
      if (f.found && f.title && !role) setRole(f.title);
    } catch (e) { setLookErr((e as Error).message); } finally { setLooking(false); }
  }
  async function copy(what: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(null); }
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="panelbox">
        <h2 style={{ marginTop: 0 }}>Who are you reaching out to?</h2>
        {leads.length > 0 && (
          <>
            <label htmlFor="o-lead">Start from this week&apos;s leads (optional)</label>
            <select className="f" id="o-lead" value="" onChange={(e) => { const l = leads[Number(e.target.value)]; if (l) { pickCompany(l.company); setNoticed(l.noticed); } }}>
              <option value="">Choose a lead…</option>
              {leads.map((l, i) => <option key={l.company + i} value={i}>{l.company} ({l.label})</option>)}
            </select>
          </>
        )}
        <label htmlFor="o-co">Company</label>
        <input type="text" id="o-co" list="o-companies" value={company} onChange={(e) => pickCompany(e.target.value)} placeholder="e.g. Tata Motors" />
        <datalist id="o-companies">{companies.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <label htmlFor="o-ct">Contact name (optional)</label>
        <input type="text" id="o-ct" value={contact} onChange={(e) => setContact(e.target.value)} />
        <label htmlFor="o-rl">Their role (optional)</label>
        <input type="text" id="o-rl" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of CSR" />
        <details className="finder" open={!!found || !!lookErr}>
          <summary>Find their phone and email</summary>
          <p className="meta" style={{ margin: '8px 0 0' }}>Looks up one named person through Lusha. Uses a Lusha credit, runs only when you press the button, and nothing is saved.</p>
          <label htmlFor="o-li">LinkedIn profile link (optional, more accurate than a name)</label>
          <input type="text" id="o-li" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={{ maxWidth: '100%' }} />
          <div className="btns">
            <button className="btn" type="button" disabled={!writable || !lookupOn || looking || (!linkedin.trim() && !(contact.trim().includes(' ') && company.trim()))} onClick={lookup}>{looking ? 'Looking…' : 'Find phone and email'}</button>
          </div>
          {!lookupOn && <p className="meta">Switched off: add LUSHA_API_KEY on the server to turn this on.</p>}
          {lookErr && <p className="err" role="alert">{lookErr}</p>}
          {found && (
            <div className="found" role="status">
              {!found.found ? <span>{found.note}</span> : (
                <>
                  <div><span className="who">{found.name}</span>{found.title ? `, ${found.title}` : ''}{found.company ? ` at ${found.company}` : ''}</div>
                  {found.note && <div className="meta">{found.note}</div>}
                  <ul>
                    {found.phones.map((p) => (
                      <li key={p.number}><span className="val">{p.number}</span><span className="kind">{p.kind}</span>{p.doNotCall && <span className="chip dnc">Do not call</span>}<button className="btn" type="button" onClick={() => copy('p' + p.number, p.number)}>{copied === 'p' + p.number ? 'Copied' : 'Copy'}</button></li>
                    ))}
                    {found.emails.map((m) => (
                      <li key={m.address}><span className="val">{m.address}</span><span className="kind">{m.kind}{m.confidence ? `, confidence ${m.confidence}` : ''}</span><button className="btn" type="button" onClick={() => copy('e' + m.address, m.address)}>{copied === 'e' + m.address ? 'Copied' : 'Copy'}</button></li>
                    ))}
                  </ul>
                  <p className="meta" style={{ margin: '8px 0 0' }}>Business contact details from Lusha. Respect Do Not Call flags and Indian telemarketing rules; check consent before you phone or message.</p>
                </>
              )}
            </div>
          )}
        </details>
        <label htmlFor="o-nt">What did you notice? (optional, the draft will only use what you write here)</label>
        <textarea id="o-nt" value={noticed} onChange={(e) => setNoticed(e.target.value)} placeholder="e.g. They opened a skilling centre in Chakan for 220 unemployed youth." />
        <label htmlFor="o-ask">Your ask (optional)</label>
        <input type="text" id="o-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Default: a 20-minute call" style={{ maxWidth: '100%' }} />
        <label htmlFor="o-tone">Version</label>
        <select className="f" id="o-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
          {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="btns">
          <button className="btn primary" type="button" disabled={!writable || busy || !company.trim()} onClick={generate}>{busy ? 'Drafting…' : draft ? 'Draft again' : 'Draft the email'}</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>

      <div className="panelbox">
        <h2 style={{ marginTop: 0 }}>Draft</h2>
        {!draft ? <p className="meta">Fill in the company and press Draft. You get an email and a shorter LinkedIn or WhatsApp message you can edit and copy. Nothing is sent from here.</p> : (
          <>
            <div className="row"><span className="chip">Draft, not sent</span><span className="meta">{draft.model}</span></div>
            {draft.warnings.map((w) => <p className="err" key={w}>{w}</p>)}
            <label htmlFor="d-sb">Subject</label>
            <input type="text" id="d-sb" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ maxWidth: '100%' }} />
            <label htmlFor="d-bd">Email</label>
            <textarea id="d-bd" style={{ minHeight: 200 }} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="btns">
              <button className="btn" type="button" onClick={() => copy('email', `${subject}\n\n${body}`)}>{copied === 'email' ? 'Copied' : 'Copy email'}</button>
              <a className="btn" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in my mail app</a>
            </div>
            <label htmlFor="d-sh">Short message (LinkedIn or WhatsApp)</label>
            <textarea id="d-sh" value={short} onChange={(e) => setShort(e.target.value)} />
            <div className="btns"><button className="btn" type="button" onClick={() => copy('short', short)}>{copied === 'short' ? 'Copied' : 'Copy short message'}</button></div>
            <p className="meta" style={{ margin: '8px 0 0' }}>This tool never sends email. Check every fact before you send.</p>
          </>
        )}
      </div>
    </div>
  );
}
