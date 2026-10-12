'use client';

import { useState } from 'react';

type Found = {
  found: boolean; name: string | null; title: string | null; company: string | null; linkedin: string | null;
  phones: { number: string; kind: string; doNotCall: boolean }[];
  emails: { address: string; kind: string; confidence: string | null }[];
  creditCharged: boolean; note: string | null;
};
type Person = { id: string; name: string; title: string | null; seniority: string | null; location: string | null; linkedin: string | null };
type Revealed = {
  phones: { number: string; kind: string; doNotCall: boolean }[];
  emails: { address: string; kind: string; confidence: string | null }[];
  creditsCharged: number | null; note: string | null;
};

/** Name part of a "Name, Role" string such as the contact shown on a lead. */
export function nameOf(contact: string | null | undefined): string {
  return (contact ?? '').split(',')[0].trim();
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as Record<string, unknown>;
}

function Details({ phones, emails, note, copied, copy }: { phones: Revealed['phones']; emails: Revealed['emails']; note: string | null; copied: string | null; copy: (k: string, t: string) => void }) {
  return (
    <>
      {note && <div className="meta">{note}</div>}
      <ul>
        {phones.map((p) => (
          <li key={p.number}><span className="val">{p.number}</span><span className="kind">{p.kind}</span>{p.doNotCall && <span className="chip dnc">Do not call</span>}<button className="btn" type="button" onClick={() => copy('p' + p.number, p.number)}>{copied === 'p' + p.number ? 'Copied' : 'Copy'}</button></li>
        ))}
        {emails.map((m) => (
          <li key={m.address}><span className="val">{m.address}</span><span className="kind">{m.kind}{m.confidence ? `, confidence ${m.confidence}` : ''}</span><button className="btn" type="button" onClick={() => copy('e' + m.address, m.address)}>{copied === 'e' + m.address ? 'Copied' : 'Copy'}</button></li>
        ))}
      </ul>
    </>
  );
}

/**
 * Who to contact at a lead's company, through Lusha.
 * 1. "Show CSR contacts" lists the CSR and sustainability people Lusha knows there (name, title, LinkedIn).
 * 2. "Reveal phone and email" for one chosen person spends Lusha credits.
 * Both run only when a button is pressed, and nothing is stored.
 */
export function ContactFinder({ company, defaultName, writable, lookupOn }: { company: string; defaultName: string; writable: boolean; lookupOn: boolean }) {
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleNote, setPeopleNote] = useState<string | null>(null);
  const [rev, setRev] = useState<Record<string, { busy?: boolean; err?: string; data?: Revealed }>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [name, setName] = useState(defaultName);
  const [linkedin, setLinkedin] = useState('');
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);

  const enabled = writable && lookupOn;
  const canLook = enabled && !looking && (linkedin.trim() !== '' || (name.trim().includes(' ') && company.trim() !== ''));

  async function search() {
    setSearching(true); setSearchErr(null); setPeople(null); setPeopleNote(null);
    try {
      const d = (await post('/api/contact/search', { company })) as { people: Person[]; note: string | null };
      setPeople(d.people); setPeopleNote(d.note);
    } catch (e) { setSearchErr((e as Error).message); } finally { setSearching(false); }
  }

  async function reveal(id: string) {
    setRev((r) => ({ ...r, [id]: { busy: true } }));
    try {
      const d = (await post('/api/contact/reveal', { id })) as { revealed: Revealed };
      setRev((r) => ({ ...r, [id]: { data: d.revealed } }));
    } catch (e) { setRev((r) => ({ ...r, [id]: { err: (e as Error).message } })); }
  }

  async function lookup() {
    setLooking(true); setErr(null); setFound(null);
    try { setFound((await post('/api/contact', { name, company, linkedin })).contact as Found); }
    catch (e) { setErr((e as Error).message); } finally { setLooking(false); }
  }

  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* the value is on screen to select */ }
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="found" role="group" aria-label={`Find a contact at ${company}`}>
      <b>Who to contact at {company}</b>
      <p className="meta" style={{ margin: '4px 0 8px' }}>Lusha lists the CSR, sustainability and community people it knows at this company. Pick one to reveal their phone and email. Reveals use Lusha credits, run only when you press a button, and nothing is saved.</p>
      <div className="btns" style={{ marginTop: 0 }}>
        <button className="btn primary" type="button" disabled={!enabled || searching} onClick={search}>{searching ? 'Searching…' : people ? 'Search again' : 'Show CSR contacts'}</button>
      </div>
      {!lookupOn && <p className="meta">Switched off: add LUSHA_API_KEY on the server to turn this on.</p>}
      {!writable && lookupOn && <p className="meta">Lookups are switched off on this copy of the app.</p>}
      {searchErr && <p className="err" role="alert">{searchErr}</p>}
      {people && (
        <div role="status" style={{ marginTop: 8 }}>
          {people.length === 0 && <span>{peopleNote ?? 'No contacts found.'} Try the name or LinkedIn box below.</span>}
          <ul>
            {people.map((p) => {
              const r = rev[p.id];
              return (
                <li key={p.id} style={{ display: 'block' }}>
                  <div className="row" style={{ alignItems: 'center' }}>
                    <span><span className="who">{p.name}</span>{p.title ? `, ${p.title}` : ''}</span>
                    {p.location && <span className="kind">{p.location}</span>}
                    {p.linkedin && <a className="kind" href={p.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
                    {!r?.data && <button className="btn" type="button" disabled={r?.busy} onClick={() => reveal(p.id)}>{r?.busy ? 'Revealing…' : 'Reveal phone and email'}</button>}
                  </div>
                  {r?.err && <p className="err" role="alert">{r.err}</p>}
                  {r?.data && <Details phones={r.data.phones} emails={r.data.emails} note={r.data.note} copied={copied} copy={copy} />}
                </li>
              );
            })}
          </ul>
          {people.length > 0 && <p className="meta" style={{ margin: '8px 0 0' }}>Business contact details from Lusha. Respect Do Not Call flags and Indian telemarketing rules; check consent before you phone or message.</p>}
        </div>
      )}

      <details className="finder">
        <summary>Already know the person? Look up by name or LinkedIn</summary>
        <label htmlFor={`cf-n-${company}`}>Full name</label>
        <input type="text" id={`cf-n-${company}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" style={{ maxWidth: '100%' }} />
        <label htmlFor={`cf-l-${company}`}>or LinkedIn profile link</label>
        <input type="text" id={`cf-l-${company}`} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/…" style={{ maxWidth: '100%' }} />
        <div className="btns">
          <button className="btn" type="button" disabled={!canLook} onClick={lookup}>{looking ? 'Looking…' : 'Find phone and email'}</button>
        </div>
        {enabled && !canLook && !looking && <p className="meta">Enter a first and last name, or a LinkedIn link.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {found && (
          <div role="status" style={{ marginTop: 10 }}>
            {!found.found ? <span>{found.note ?? 'No match found.'}</span> : (
              <>
                <div><span className="who">{found.name}</span>{found.title ? `, ${found.title}` : ''}{found.company ? ` at ${found.company}` : ''}</div>
                <Details phones={found.phones} emails={found.emails} note={found.note} copied={copied} copy={copy} />
              </>
            )}
          </div>
        )}
      </details>
    </div>
  );
}
