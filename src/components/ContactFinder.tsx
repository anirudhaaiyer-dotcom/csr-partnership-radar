'use client';

import { useState } from 'react';

type Found = {
  found: boolean; name: string | null; title: string | null; company: string | null; linkedin: string | null;
  phones: { number: string; kind: string; doNotCall: boolean }[];
  emails: { address: string; kind: string; confidence: string | null }[];
  creditCharged: boolean; note: string | null;
};

/** Name part of a "Name, Role" string such as the contact shown on a lead. */
export function nameOf(contact: string | null | undefined): string {
  return (contact ?? '').split(',')[0].trim();
}

/**
 * One-click Lusha lookup for a single named person at a lead's company.
 * Runs only when the button is pressed, uses a Lusha credit, and nothing is stored.
 */
export function ContactFinder({ company, defaultName, writable, lookupOn }: { company: string; defaultName: string; writable: boolean; lookupOn: boolean }) {
  const [name, setName] = useState(defaultName);
  const [linkedin, setLinkedin] = useState('');
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const canLook = writable && lookupOn && !looking && (linkedin.trim() !== '' || (name.trim().includes(' ') && company.trim() !== ''));

  async function lookup() {
    setLooking(true); setErr(null); setFound(null);
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, company, linkedin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      setFound((data as { contact: Found }).contact);
    } catch (e) { setErr((e as Error).message); } finally { setLooking(false); }
  }

  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* the value is on screen to select */ }
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="found" role="group" aria-label={`Find a contact at ${company}`}>
      <b>Find a contact at {company}</b>
      <p className="meta" style={{ margin: '4px 0 0' }}>Looks up one named person through Lusha. Uses a Lusha credit, runs only when you press the button, and nothing is saved.</p>
      <label htmlFor={`cf-n-${company}`}>Full name</label>
      <input type="text" id={`cf-n-${company}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" style={{ maxWidth: '100%' }} />
      <label htmlFor={`cf-l-${company}`}>or LinkedIn profile link (more accurate)</label>
      <input type="text" id={`cf-l-${company}`} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={{ maxWidth: '100%' }} />
      <div className="btns">
        <button className="btn primary" type="button" disabled={!canLook} onClick={lookup}>{looking ? 'Looking…' : 'Find phone and email'}</button>
      </div>
      {!lookupOn && <p className="meta">Switched off: add LUSHA_API_KEY on the server to turn this on.</p>}
      {!writable && lookupOn && <p className="meta">Lookups are switched off on this copy of the app.</p>}
      {lookupOn && writable && !canLook && !looking && <p className="meta">Enter the person's full name (first and last), or a LinkedIn link.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {found && (
        <div role="status" style={{ marginTop: 10 }}>
          {!found.found ? <span>{found.note ?? 'No match found.'}</span> : (
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
                {found.phones.length === 0 && found.emails.length === 0 && <li><span className="kind">Lusha knows this person but has no phone or email on file.</span></li>}
              </ul>
              <p className="meta" style={{ margin: '8px 0 0' }}>Business contact details from Lusha. Respect Do Not Call flags and Indian telemarketing rules; check consent before you phone or message.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
