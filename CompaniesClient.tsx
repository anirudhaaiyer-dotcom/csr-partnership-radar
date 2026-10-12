'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Company } from '@/lib/types';
import { formatDate } from '@/lib/time';

export function CompaniesClient({ companies, writable }: { companies: Company[]; writable: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const blank = { name: '', section135: 'unknown', checked_on: '', source_checked: '', relationship: false, hq_maharashtra: false, excluded: false, excluded_reason: '', contact_name: '', contact_role: '', contact_how: '' };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/companies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setMsg({ ok: true, text: `Saved ${d.company.name}.` });
      setF(blank);
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function remove(key: string) {
    setBusy(true);
    try { await fetch(`/api/companies?key=${encodeURIComponent(key)}`, { method: 'DELETE' }); router.refresh(); } finally { setBusy(false); }
  }
  const edit = (c: Company) => setF({ name: c.name, section135: c.section135, checked_on: c.checked_on ?? '', source_checked: c.source_checked ?? '', relationship: c.relationship, hq_maharashtra: c.hq_maharashtra, excluded: c.excluded, excluded_reason: c.excluded_reason ?? '', contact_name: c.contact_name ?? '', contact_role: c.contact_role ?? '', contact_how: c.contact_how ?? '' });

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Company</th><th>Section 135 (set by you)</th><th>Checked on, source</th><th>Relationship</th><th>Contact</th><th>Excluded</th><th /></tr></thead>
          <tbody>
            {companies.length === 0 && <tr><td colSpan={7} className="meta">No companies added yet.</td></tr>}
            {companies.map((c) => (
              <tr key={c.key}>
                <td>{c.name}{c.hq_maharashtra ? <><br /><span className="meta">HQ in Maharashtra</span></> : null}</td>
                <td>{c.section135[0].toUpperCase() + c.section135.slice(1)}</td>
                <td>{c.checked_on ? formatDate(c.checked_on) : '—'}{c.source_checked ? `, ${c.source_checked}` : ''}</td>
                <td>{c.relationship ? 'Existing' : '—'}</td>
                <td>{c.contact_name ? `${c.contact_name}${c.contact_role ? ', ' + c.contact_role : ''}` : '—'}{c.contact_how ? <><br /><span className="meta">{c.contact_how}</span></> : null}</td>
                <td>{c.excluded ? `Yes${c.excluded_reason ? ': ' + c.excluded_reason : ''}` : 'No'}</td>
                <td><button className="btn" type="button" onClick={() => edit(c)}>Edit</button> <button className="btn" type="button" disabled={!writable || busy} onClick={() => remove(c.key)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Add or update a company</h2>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid2">
          <div>
            <label htmlFor="c1">Company</label><input id="c1" type="text" value={f.name} onChange={(e) => set('name', e.target.value)} required />
            <label htmlFor="c2">Section 135 status</label>
            <select className="f" id="c2" value={f.section135} onChange={(e) => set('section135', e.target.value)}><option value="unknown">Unknown</option><option value="passed">Passed</option><option value="failed">Failed</option></select>
            <label htmlFor="c3">Checked on (yyyy-mm-dd)</label><input id="c3" type="text" value={f.checked_on} onChange={(e) => set('checked_on', e.target.value)} placeholder="Needed unless the status is Unknown" />
            <label htmlFor="c4">Source you checked</label><input id="c4" type="text" value={f.source_checked} onChange={(e) => set('source_checked', e.target.value)} placeholder="For example, the latest annual report" />
            <label className="chk"><input type="checkbox" checked={f.relationship} onChange={(e) => set('relationship', e.target.checked)} /> Existing relationship (earns the 5 actionability points)</label>
            <label className="chk"><input type="checkbox" checked={f.hq_maharashtra} onChange={(e) => set('hq_maharashtra', e.target.checked)} /> Headquartered in Maharashtra</label>
            <label className="chk"><input type="checkbox" checked={f.excluded} onChange={(e) => set('excluded', e.target.checked)} /> Excluded</label>
            {f.excluded && <><label htmlFor="c5">Why excluded</label><input id="c5" type="text" value={f.excluded_reason} onChange={(e) => set('excluded_reason', e.target.value)} /></>}
          </div>
          <div>
            <label htmlFor="c7">Contact name</label><input id="c7" type="text" value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
            <label htmlFor="c8">Role</label><input id="c8" type="text" value={f.contact_role} onChange={(e) => set('contact_role', e.target.value)} />
            <label htmlFor="c9">How you know them</label><input id="c9" type="text" value={f.contact_how} onChange={(e) => set('contact_how', e.target.value)} />
            <div className="btns"><button className="btn primary" type="submit" disabled={!writable || busy} title={writable ? '' : 'Changes are disabled until APP_PASSWORD is set'}>Save company</button></div>
            {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
          </div>
        </div>
      </form>
    </>
  );
}
