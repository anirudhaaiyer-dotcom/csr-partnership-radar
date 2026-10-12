import type { Opportunity } from '@/lib/types';

/** Horizontal bar with a direct value label. Single hue, rounded data end anchored to the baseline. */
export function Bar({ label, value, max, tone = 'navy', suffix = '' }: { label: string; value: number; max: number; tone?: 'navy' | 'green' | 'amber' | 'muted'; suffix?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(value > 0 ? 3 : 0, (value / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden="true"><span className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} /></span>
      <span className="bar-val">{value}{suffix}</span>
    </div>
  );
}

/** 0-100 score bar with tick marks at the Emerging, Watch and Call thresholds. */
export function ScoreBar({ score, emerging, watch, call }: { score: number; emerging: number; watch: number; call: number }) {
  const tone = score >= call ? 'green' : score >= watch ? 'amber' : 'navy';
  return (
    <span className="scorebar" role="img" aria-label={`Score ${score} out of 100. Watch starts at ${watch}, Call at ${call}.`}>
      <span className={`bar-fill ${tone}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      {[emerging, watch, call].map((t) => <i key={t} className="tick" style={{ left: `${t}%` }} />)}
    </span>
  );
}

const REGION: Record<string, string> = { pune: 'Pune', maharashtra: 'Maharashtra', base_maharashtra: 'Maharashtra', pan_india: 'Pan-India', other: 'Other state or not stated' };

export function Glance({ leads, reviewed, extracted, thresholds, runLabel }: {
  leads: { call: Opportunity[]; watch: Opportunity[]; emerging: Opportunity[]; policy: Opportunity[] };
  reviewed: number; extracted: number; thresholds: { emerging: number; watch: number; call: number }; runLabel: string;
}) {
  const scored = [...leads.call, ...leads.watch, ...leads.emerging];
  const regions = new Map<string, number>();
  for (const o of scored) regions.set(REGION[o.geography] ?? 'Other state or not stated', (regions.get(REGION[o.geography] ?? 'Other state or not stated') ?? 0) + 1);
  const regionRows = [...regions.entries()].sort((a, b) => b[1] - a[1]);
  const leadCount = scored.length + leads.policy.length;
  const top = [...scored].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 8);
  const maxFun = Math.max(reviewed, extracted, leadCount, 1);
  return (
    <section className="glance" aria-label="This week at a glance">
      <h2 style={{ marginTop: 0 }}>This week at a glance</h2>
      <div className="glance-grid">
        <div>
          <h3 className="gh">From headlines to leads</h3>
          <Bar label="Items reviewed" value={reviewed} max={maxFun} tone="muted" />
          <Bar label="Companies found" value={extracted} max={maxFun} />
          <Bar label="Leads shown" value={leadCount} max={maxFun} tone="green" />
          <p className="meta">{runLabel}</p>
        </div>
        <div>
          <h3 className="gh">Leads by tier</h3>
          <Bar label="Call this week" value={leads.call.length} max={Math.max(leadCount, 1)} tone="green" />
          <Bar label="Watch" value={leads.watch.length} max={Math.max(leadCount, 1)} tone="amber" />
          <Bar label="Emerging" value={leads.emerging.length} max={Math.max(leadCount, 1)} />
          <Bar label="Policy updates" value={leads.policy.length} max={Math.max(leadCount, 1)} tone="muted" />
        </div>
        <div>
          <h3 className="gh">Leads by region</h3>
          {regionRows.length ? regionRows.map(([k, v]) => <Bar key={k} label={k} value={v} max={Math.max(scored.length, 1)} />) : <p className="meta">No scored leads yet.</p>}
        </div>
      </div>
      {top.length > 0 && (
        <>
          <h3 className="gh" style={{ marginTop: 18 }}>Lead scores against the bars</h3>
          <div className="score-list">
            {top.map((o) => (
              <div className="bar-row" key={o.id}>
                <span className="bar-label">{o.company}</span>
                <ScoreBar score={o.total ?? 0} {...thresholds} />
                <span className="bar-val">{o.total}</span>
              </div>
            ))}
          </div>
          <p className="meta">Ticks mark Emerging ({thresholds.emerging}), Watch ({thresholds.watch}) and Call ({thresholds.call}). Out of 100.</p>
        </>
      )}
    </section>
  );
}
