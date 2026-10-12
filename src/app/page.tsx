import { Glance, ScoreBar } from '@/components/Glance';
import { OpportunityCard } from '@/components/OpportunityCard';
import { EMERGING_MIN } from '@/lib/config';
import { RunButton } from '@/components/RunButton';
import { writesEnabled } from '@/lib/auth';
import { repo } from '@/lib/server';
import { formatDate, formatDateTimeIST } from '@/lib/time';
import type { DraftRow, Opportunity } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function Priorities() {
  const r = repo();
  const ws = await loadWorkspace(r);
  const writable = writesEnabled();
  const { lists } = ws;
  const latest = ws.runs.find((x) => x.status !== 'running');

  const drafts = new Map<string, DraftRow | null>();
  await Promise.all([...lists.call, ...lists.watch, ...lists.late, ...lists.closing].filter((o) => o.pursued).map(async (o) => drafts.set(o.id, await r.getDraft(o.id))));
  const card = (o: Opportunity, k: string) => <OpportunityCard key={k + o.id} o={o} initialDraft={drafts.get(o.id) ?? null} writable={writable} lookupOn={!!process.env.LUSHA_API_KEY} />;

  const dataLabel = { current: 'Current', stale: 'Stale', failed: 'Failed', partial: 'Partial', never: ws.demo ? 'Demo' : 'No run yet' }[ws.status];
  const stripClass = ws.status === 'failed' ? 'strip bad' : ws.status === 'stale' || ws.status === 'partial' ? 'strip warn' : 'strip';
  const sourcesOk = latest ? `${latest.sources.filter((s) => s.ok).length} of ${latest.sources.length}` : '—';

  const scored = [...lists.call, ...lists.watch, ...lists.emerging];
  const best = [...scored].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0];
  const thresholds = { emerging: EMERGING_MIN, watch: ws.settings.watch_min, call: ws.settings.call_min };
  const nothing = lists.call.length + lists.watch.length + lists.policy.length + lists.closing.length + lists.late.length + lists.emerging.length === 0;

  return (
    <>
      <h1>Priorities</h1>
      <p className="sub">Which corporate partner to act on now, why, and what to do next.</p>

      <div className={stripClass} role="status">
        {ws.status === 'failed' && <span><b>This week&apos;s run did not finish.</b> Last successful run: {ws.lastGoodRun ? formatDateTimeIST(ws.lastGoodRun.finished_at) : 'none yet'}. Cards below are from stored data.</span>}
        {ws.status === 'partial' && <span><b>Partial run.</b> {latest?.notes.slice(-2).join(' ')}</span>}
        {ws.status === 'stale' && <span><b>Data is stale.</b> Last successful run: {formatDateTimeIST(ws.lastGoodRun?.finished_at)}.</span>}
        {ws.status === 'never' && <span><b>{ws.demo ? 'Seeded sample, not a live run.' : 'No run has completed yet.'}</b></span>}
        {ws.status === 'current' && <span>Last successful run: {formatDateTimeIST(ws.lastGoodRun?.finished_at)}</span>}
        <span>Sources responding: {sourcesOk}</span>
        <span>Next digest: Monday morning, about 6 AM IST</span>
        <span>NGO readiness: {ws.readiness.state === 'passed' ? 'Passed' : ws.readiness.state === 'failed' ? 'Failed' : 'Not fully set'}</span>
        {!ws.demo && <RunButton disabled={!writable} title={writable ? '' : 'Changes are disabled until APP_PASSWORD is set'} />}
      </div>

      <div className="hero">
        <div>
          <b>{lists.call.length + lists.watch.length + lists.emerging.length > 0 ? `${lists.call.length} to call, ${lists.watch.length} to watch, ${lists.emerging.length} emerging` : 'No leads yet this week'}</b>
          <p>{best ? `Strongest lead: ${best.company} (${best.total}/100).` : 'Run the search to fetch this week’s CSR activity.'} Draft an email to any company on the Outreach tab.</p>
        </div>
        <div className="pills"><span className="pill">{latest?.reviewed ?? 0} items reviewed</span><span className="pill">{lists.policy.length} policy update{lists.policy.length === 1 ? '' : 's'}</span></div>
      </div>

      <div className="nums" aria-label="Key numbers">
        <div className="num"><b>{lists.call.length}</b><span>Call this week</span></div>
        <div className="num"><b>{lists.watch.length}</b><span>Watch</span></div>
        <div className="num"><b>{lists.emerging.length}</b><span>Emerging</span></div>
        <div className="num"><b>{lists.closing.length}</b><span>Closing before next Monday</span></div>
        <div className="num"><b>{dataLabel}</b><span>Data status</span></div>
      </div>

      <div className="guide" aria-label="How to read the tiers">
        <span><b>Call this week:</b> score {ws.settings.call_min}+ or an open partner search. Reach out now.</span>
        <span><b>Watch:</b> {ws.settings.watch_min}–{ws.settings.call_min - 1}. Relevant, not yet a reason to call.</span>
        <span><b>Emerging:</b> {EMERGING_MIN}–{ws.settings.watch_min - 1}. Active in your space, keep an eye.</span>
      </div>
      {scored.length + lists.policy.length > 0 && <Glance leads={{ call: lists.call, watch: lists.watch, emerging: lists.emerging, policy: lists.policy }} reviewed={latest?.reviewed ?? 0} extracted={ws.all.length} thresholds={thresholds} runLabel={latest ? `Latest run, ${formatDateTimeIST(latest.finished_at)}` : ''} />}

      {ws.readiness.state === 'failed' && <div className="strip bad" role="alert">NGO readiness check failed, so every item is excluded. {ws.readiness.reason} Fix it in Settings.</div>}

      {lists.closing.length > 0 && (
        <>
          <h2>Closing before next Monday</h2>
          <p className="sub">Open calls with a deadline before the next digest, whatever their verdict.</p>
          {lists.closing.map((o) => (
            <div className="close" key={'cl' + o.id}><b>{o.company}</b><span>closes {formatDate(o.deadline)}</span><span className="chip">{o.verdict === 'call' ? 'Call this week' : 'Watch'}</span><span>{o.next_action}</span></div>
          ))}
        </>
      )}

      <h2>Call this week</h2>
      {lists.call.length ? lists.call.map((o) => card(o, 'c')) : (
        <div className="empty">
          <b>{nothing && ws.status === 'never' ? 'Nothing to show yet' : ws.status === 'failed' ? 'No run data this week' : 'Nothing reached Call this week'}</b>
          {ws.status === 'current' && latest ? <>Run completed {formatDateTimeIST(latest.finished_at)}. {latest.reviewed} items reviewed. Nothing here means nothing qualified, not that the run failed.</> :
            ws.demo ? <>The seeded headlines carry only short quotes, and none of them is strong enough on its own. Live runs read the article text where the publisher allows it.</> :
            ws.status === 'failed' ? <>See System health for what failed.</> : <>Use Run now to fetch the first set.</>}
        </div>
      )}

      {lists.watch.length > 0 && <><h2>Watch</h2>{lists.watch.map((o) => card(o, 'w'))}</>}
      {lists.emerging.length > 0 && (
        <>
          <h2>Emerging</h2>
          <p className="sub">Real education or skilling CSR activity that scored {EMERGING_MIN} to {ws.settings.watch_min - 1}, below the Watch bar of {ws.settings.watch_min}. None is a partner search yet, but these companies are active in your space. Evidence for every item is on the Research tab.</p>
          {lists.emerging.map((o) => (
            <div className="lead" key={'em' + o.id}>
              <h3>{o.company}</h3>
              <div className="score-col"><ScoreBar score={o.total ?? 0} {...thresholds} /><b>{o.total}</b></div>
              <p className="why" style={{ margin: 0 }}>{o.why_now}. <a href={o.sources[0]?.url} target="_blank" rel="noreferrer">{o.sources[0]?.publisher ?? 'Source'}: {o.sources[0]?.title}</a></p>
              <div className="acts">
                <a className="btn" href={`/outreach?${new URLSearchParams({ company: o.company, noticed: o.sources[0]?.title ?? '' }).toString()}`}>Draft outreach</a>
                <span className="meta">{o.factors.filter((f) => f.points > 0).length} of {o.factors.length} factors scored</span>
              </div>
            </div>
          ))}
        </>
      )}
      {lists.policy.length > 0 && <><h2>Policy updates</h2>{lists.policy.map((o) => card(o, 'p'))}</>}
      {lists.late.length > 0 && <><h2>Late finds</h2><p className="sub">Never shown before, aged 8 to 21 days, fresh score of at least {ws.settings.late_min_fresh_score}, at most {ws.settings.late_max}.</p>{lists.late.map((o) => card(o, 'l'))}</>}

      {(lists.excluded.length > 0 || lists.skipped > 0) && (
        <details style={{ marginTop: 24 }}>
          <summary>Excluded ({lists.excluded.length}) and skipped ({lists.skipped}) this week</summary>
          <ul>{lists.excluded.map((o) => <li key={o.id}>{o.company}: {o.verdict_reason}</li>)}</ul>
          <p className="meta">Skipped items scored below {ws.settings.watch_min}.</p>
        </details>
      )}
    </>
  );
}
