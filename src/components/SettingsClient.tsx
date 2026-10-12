'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Settings, Tri } from '@/lib/types';

export function SettingsClient({ settings, writable }: { settings: Settings; writable: boolean }) {
  const router = useRouter();
  const [s, setS] = useState({
    call_min: settings.call_min, watch_min: settings.watch_min, fit_floor: settings.fit_floor,
    digest_to: settings.digest_to ?? '', geo: { ...settings.geo_points }, excluded: settings.excluded_keywords.join('\n'), sectors: settings.sectors.join('\n'), queries: settings.queries.join('\n'),
    csr1: settings.readiness.csr1, reg12a: settings.readiness.reg12a, g80: settings.readiness.g80_valid_until ?? '', years: settings.readiness.record_years === null ? '' : String(settings.readiness.record_years),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          call_min: Number(s.call_min), watch_min: Number(s.watch_min), fit_floor: Number(s.fit_floor), digest_to: s.digest_to, geo_points: s.geo,
          excluded_keywords: lines(s.excluded), sectors: lines(s.sectors), queries: lines(s.queries),
          readiness: { csr1: s.csr1, reg12a: s.reg12a, g80_valid_until: s.g80 || null, record_years: s.years === '' ? null : Number(s.years) },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setMsg({ ok: true, text: 'Saved. The new rules apply to the next page load and the next run.' });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const tri = (k: 'csr1' | 'reg12a') => (
    <select className="f" id={k} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value as Tri })}>
      <option value="unknown">Not set</option><option value="passed">Met</option><option value="failed">Not met</option>
    </select>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid2">
        <div>
          <h2>Verdict thresholds</h2>
          <label htmlFor="s1">Call this week at or above</label><input id="s1" type="number" value={s.call_min} onChange={(e) => setS({ ...s, call_min: Number(e.target.value) })} />
          <label htmlFor="s2">Watch at or above</label><input id="s2" type="number" value={s.watch_min} onChange={(e) => setS({ ...s, watch_min: Number(e.target.value) })} />
          <label htmlFor="s3">Minimum beneficiary points for Call this week</label><input id="s3" type="number" value={s.fit_floor} onChange={(e) => setS({ ...s, fit_floor: Number(e.target.value) })} />
          <h2>Where we work</h2>
          <p className="meta" style={{ margin: '0 0 4px' }}>Points a lead earns for its location (0 to 13). Raise a region as your programme footprint grows.</p>
          {([['pune', 'Pune'], ['maharashtra', 'Rest of Maharashtra'], ['pan_india', 'Pan-India'], ['base_maharashtra', 'Company based in Maharashtra']] as const).map(([k, l]) => (
            <div key={k}><label htmlFor={'geo-' + k}>{l}</label><input id={'geo-' + k} type="number" min={0} max={13} value={s.geo[k]} onChange={(e) => setS({ ...s, geo: { ...s.geo, [k]: Number(e.target.value) } })} /></div>
          ))}
          <div className="meta">Other factor weights are fixed in this version. An existing relationship earns the 5 actionability points.</div>
          <h2>Our NGO readiness</h2>
          <label htmlFor="csr1">CSR-1 registration</label>{tri('csr1')}
          <label htmlFor="reg12a">12A registration</label>{tri('reg12a')}
          <label htmlFor="g80">80G valid until (yyyy-mm-dd)</label><input id="g80" type="text" value={s.g80} onChange={(e) => setS({ ...s, g80: e.target.value })} />
          <label htmlFor="yrs">Years of record</label><input id="yrs" type="number" value={s.years} onChange={(e) => setS({ ...s, years: e.target.value })} />
          <div className="meta">If any item is Not met, every item is excluded. Leave Not set until you have confirmed it.</div>
        </div>
        <div>
          <h2>Sectors</h2>
          <label htmlFor="sec">Sectors to track, one per line</label><textarea id="sec" value={s.sectors} onChange={(e) => setS({ ...s, sectors: e.target.value })} />
          <h2>Exclusions</h2>
          <label htmlFor="ex">Keywords that exclude an item, one per line</label><textarea id="ex" value={s.excluded} onChange={(e) => setS({ ...s, excluded: e.target.value })} />
          <h2>Search queries</h2>
          <label htmlFor="qs">Google News queries, one per line</label><textarea id="qs" style={{ minHeight: 140 }} value={s.queries} onChange={(e) => setS({ ...s, queries: e.target.value })} />
          <h2>Digest</h2>
          <label htmlFor="rc">Recipient email</label><input id="rc" type="text" value={s.digest_to} onChange={(e) => setS({ ...s, digest_to: e.target.value })} placeholder="Falls back to DIGEST_TO" />
          <label>Schedule</label><input type="text" value="Monday morning (job runs 6:00 AM IST)" disabled />
          <label>Window</label><input type="text" value="Main digest 0 to 7 days; late finds 8 to 21 days" disabled />
        </div>
      </div>
      <div className="btns"><button className="btn primary" type="submit" disabled={!writable || busy} title={writable ? '' : 'Changes are disabled until APP_PASSWORD is set'}>Save settings</button></div>
      {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
    </form>
  );
}
