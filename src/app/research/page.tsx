import { EMERGING_MIN } from '@/lib/config';
import { looksRelevant } from '@/lib/extract';
import { repo } from '@/lib/server';
import { formatDate } from '@/lib/time';
import { loadWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const VERDICT: Record<string, string> = { call: 'Call this week', watch: 'Watch', skip: 'Skipped', excluded: 'Excluded', policy: 'Policy update' };
const SOURCE: Record<string, string> = { google_news: 'Google News', bing_news: 'Bing News', gdelt: 'GDELT', seed: 'Seeded sample' };

export default async function Research() {
  const r = repo();
  const ws = await loadWorkspace(r);
  const since = new Date(new Date(ws.now).getTime() - (ws.settings.discovery_window_days + 1) * 86400000).toISOString();
  const articles = await r.listArticles(since);

  const opps = new Map<string, (typeof ws.all)[number]>();
  for (const o of ws.all) for (const s of o.sources) opps.set(s.id, o);

  const rows = articles
    .map((a) => {
      const o = opps.get(a.id);
      let status: string;
      let detail = '';
      let rank = 5;
      if (o) {
        status = o.verdict === 'skip' && (o.total ?? 0) >= EMERGING_MIN ? 'Emerging' : VERDICT[o.verdict] ?? o.verdict;
        detail = `${o.company}${o.total !== null ? `, ${o.total}/100` : ''}. ${o.verdict_reason}`;
        rank = o.verdict === 'call' ? 0 : o.verdict === 'watch' ? 1 : status === 'Emerging' ? 2 : o.verdict === 'policy' ? 2 : 3;
      } else if (a.extraction) {
        status = 'Analysed, no lead';
        detail = a.extraction.signal.value && a.extraction.signal.value !== 'none' ? `Signal: ${a.extraction.signal.value}` : 'No CSR funding or partner signal found in the text';
        rank = 4;
      } else if (!looksRelevant(a)) {
        status = 'Filtered out';
        detail = 'Headline has no education, skilling or youth topic';
      } else {
        status = 'Waiting for analysis';
        detail = `Queued for the next run (${a.extraction_attempts} attempts so far)`;
        rank = 4;
      }
      return { a, status, detail, rank };
    })
    .sort((x, y) => x.rank - y.rank || (y.a.published_at ?? '').localeCompare(x.a.published_at ?? ''));

  const n = (s: string) => rows.filter((x) => x.status === s).length;
  const leads = rows.filter((x) => x.status === 'Call this week' || x.status === 'Watch').length;
  const bySource = new Map<string, number>();
  for (const a of articles) bySource.set(SOURCE[a.source] ?? a.source, (bySource.get(SOURCE[a.source] ?? a.source) ?? 0) + 1);

  return (
    <>
      <h1>Research</h1>
      <p className="sub">Everything the weekly search found, and what happened to each item. Leads are at the top; the Priorities page shows only the ones worth acting on.</p>
      <table>
        <tbody>
          <tr><td>Items reviewed (last {ws.settings.discovery_window_days} days)</td><td>{articles.length}</td></tr>
          <tr><td>Leads (Call this week or Watch)</td><td>{leads}</td></tr>
          <tr><td>Emerging</td><td>{n('Emerging')}</td></tr>
          <tr><td>Policy updates</td><td>{n('Policy update')}</td></tr>
          <tr><td>Analysed, no lead</td><td>{n('Analysed, no lead') + n('Skipped') + n('Excluded')}</td></tr>
          <tr><td>Waiting for analysis</td><td>{n('Waiting for analysis')}</td></tr>
          <tr><td>Filtered out as off-topic</td><td>{n('Filtered out')}</td></tr>
          <tr><td>By source</td><td>{[...bySource.entries()].map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</td></tr>
        </tbody>
      </table>
      <h2>All items</h2>
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Decision</th><th>Headline</th><th>Publisher</th><th>Published</th><th>Source</th><th>Why</th></tr></thead>
            <tbody>
              {rows.map(({ a, status, detail }) => (
                <tr key={a.id}>
                  <td>{status}</td>
                  <td><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a></td>
                  <td>{a.publisher ?? a.publisher_domain ?? '—'}</td>
                  <td>{a.published_at ? formatDate(a.published_at) : '—'}</td>
                  <td>{SOURCE[a.source] ?? a.source}</td>
                  <td>{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="meta">Nothing yet. Press Run now on the Priorities page.</p>}
    </>
  );
}
