import { OutreachClient } from '@/components/OutreachClient';
import { writesEnabled } from '@/lib/auth';
import { repo } from '@/lib/server';
import { loadWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function Outreach({ searchParams }: { searchParams: Promise<{ company?: string; noticed?: string }> }) {
  const sp = await searchParams;
  const ws = await loadWorkspace(repo());
  const tier = (o: (typeof ws.all)[number]) => (o.verdict === 'call' ? 'Call' : o.verdict === 'watch' ? 'Watch' : 'Emerging');
  const picks = [...ws.lists.call, ...ws.lists.watch, ...ws.lists.emerging];
  const seen = new Set<string>();
  const leads = picks.filter((o) => (seen.has(o.company_key) ? false : (seen.add(o.company_key), true))).map((o) => ({
    company: o.company,
    label: tier(o),
    noticed: [o.factors.find((f) => f.key === 'signal')?.quote, o.factors.find((f) => f.key === 'beneficiary')?.quote].filter(Boolean).join(' ') || o.sources[0]?.title || '',
  }));
  const companies = ws.companies.map((c) => ({ name: c.name, contact: c.contact_name ?? '', role: c.contact_role ?? '' }));
  return (
    <>
      <h1>Outreach</h1>
      <p className="sub">Draft a first email to any company, whether or not it is on this week&apos;s list. You review it and send it yourself.</p>
      <OutreachClient leads={leads} companies={companies} writable={writesEnabled()} initial={{ company: sp.company ?? '', noticed: sp.noticed ?? '' }} />
    </>
  );
}
