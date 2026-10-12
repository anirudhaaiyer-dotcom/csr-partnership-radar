import { RunButton } from '@/components/RunButton';
import { writesEnabled } from '@/lib/auth';
import { repo } from '@/lib/server';
import { formatDateTimeIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

const set = (v: string | undefined) => (v ? 'Set' : 'Not set');

export default async function Health() {
  const r = repo();
  const runs = await r.listRuns(10);
  const latest = runs.find((x) => x.status !== 'running');
  const env: [string, string][] = [
    ['Database', r.demo ? 'Not connected (demo mode)' : 'Connected (Neon Postgres)'],
    ['GEMINI_API_KEY', set(process.env.GEMINI_API_KEY)],
    ['GEMINI_MODEL', process.env.GEMINI_MODEL || 'gemini-flash-latest (default)'],
    ['RESEND_API_KEY', set(process.env.RESEND_API_KEY)],
    ['DIGEST_FROM / DIGEST_TO', `${set(process.env.DIGEST_FROM)} / ${set(process.env.DIGEST_TO)}`],
    ['CRON_SECRET', set(process.env.CRON_SECRET)],
    ['APP_PASSWORD', set(process.env.APP_PASSWORD)],
    ['APP_URL', set(process.env.APP_URL)],
  ];
  return (
    <>
      <h1>System health</h1>
      <p className="sub">Technical detail for the operator. Nothing on this page is needed to make Monday&apos;s decision. Secret values are never shown.</p>
      {!r.demo && <RunButton disabled={!writesEnabled()} />}

      <h2>Configuration</h2>
      <table><tbody>{env.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>

      <h2>Sources and services, latest run</h2>
      {latest ? (
        <table>
          <thead><tr><th>Name</th><th>Result</th><th>Items</th><th>Error class</th><th>Detail</th></tr></thead>
          <tbody>{latest.sources.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.ok ? 'ok' : 'failed'}</td><td>{s.items}</td><td>{s.error_class ?? '—'}</td><td>{s.detail ?? ''}</td></tr>)}</tbody>
        </table>
      ) : <p className="meta">No run yet.</p>}

      <h2>Run log</h2>
      {runs.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Reviewed</th><th>Extracted</th><th>Queued</th><th>Notes</th></tr></thead>
            <tbody>{runs.map((x) => <tr key={x.id}><td>{formatDateTimeIST(x.started_at)}</td><td>{x.trigger}</td><td>{x.status}</td><td>{x.reviewed}</td><td>{x.extracted}</td><td>{x.queued}</td><td>{x.notes.join(' · ')}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="meta">No runs recorded.</p>}
      <p className="footer">Gemini free-tier limits apply per project and reset at midnight Pacific. The scheduled job runs daily at 00:30 UTC and sends the digest on Monday, or once on Tuesday or Wednesday if Monday&apos;s was missed.</p>
    </>
  );
}
