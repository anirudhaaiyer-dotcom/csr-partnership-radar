import { describe, expect, it } from 'vitest';
import { QuotaError } from '@/lib/http';
import type { JsonModel } from '@/lib/gemini';
import { extractBatch, looksRelevant, verifyExtraction } from '@/lib/extract';
import { draftWarnings, generateDraft } from '@/lib/draft';
import { buildOpportunities } from '@/lib/opportunities';
import { fetchGoogleNews, parseGdelt, parseGoogleRss } from '@/lib/sources/feeds';
import { extractBodyText, robotsAllows } from '@/lib/sources/articleText';
import { classifySource } from '@/lib/util';
import { art, NOW, q, settings, strongEx } from './helpers';

// Synthetic feed text for parser tests only.
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>Acme Ltd opens call for NGO partners - Example Times</title><link>https://news.google.com/rss/articles/AAA</link>
<pubDate>Mon, 05 Oct 2026 06:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Acme Ltd opens call for NGO partners&lt;/a&gt;</description>
<source url="https://www.exampletimes.com">Example Times</source></item>
<item><title>Second story</title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Tue, 06 Oct 2026 06:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('feeds', () => {
  it('parses Google News RSS, strips the publisher suffix and reads the publisher domain', () => {
    const items = parseGoogleRss(RSS);
    expect(items.length).toBe(2);
    expect(items[0].title).toBe('Acme Ltd opens call for NGO partners');
    expect(items[0].publisher).toBe('Example Times');
    expect(items[0].publisher_domain).toBe('exampletimes.com');
    expect(items[0].published_at).toBe('2026-10-05T06:00:00.000Z');
    expect(items[0].snippet).toBe('');
  });
  it('parses GDELT json and its date format', () => {
    const items = parseGdelt(JSON.stringify({ articles: [{ url: 'https://a.com/x', title: 'T', seendate: '20261005T060000Z', domain: 'a.com' }] }));
    expect(items[0].published_at).toBe('2026-10-05T06:00:00Z');
    expect(() => parseGdelt('<html>')).toThrow();
  });
  it('records a failing source with its error class and does not throw', async () => {
    const f = async () => new Response('no', { status: 503 });
    const r = await fetchGoogleNews(['q1'], f as never, 0);
    expect(r.stat.ok).toBe(false);
    expect(r.stat.error_class).toBe('http_503');
  });
  it('reports a partly failing source as ok with the failure counted', async () => {
    let n = 0;
    const f = async () => (n++ === 0 ? new Response(RSS, { status: 200 }) : new Response('no', { status: 403 }));
    const r = await fetchGoogleNews(['q1', 'q2'], f as never, 0);
    expect(r.stat.ok).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.stat.error_class).toBe('http_403');
  });
});

describe('article text', () => {
  it('honours robots.txt disallow rules for all agents', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /private', '/private/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /private', '/news/x')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/news/x')).toBe(false);
    expect(robotsAllows('User-agent: other\nDisallow: /', '/news/x')).toBe(true);
  });
  it('extracts paragraph text and ignores scripts and short fragments', () => {
    const html = '<script>var a=1</script><article><p>Short.</p><p>This paragraph is clearly long enough to be counted as body text by the reader.</p></article>';
    expect(extractBodyText(html)).toBe('This paragraph is clearly long enough to be counted as body text by the reader.');
  });
});

describe('extraction verification (S7)', () => {
  const text = 'Acme Ltd will invest Rs 12 crore to skill school dropouts in Pune. Applications close on 30 November 2026.';
  it('keeps fields whose quote is in the text and drops the rest', () => {
    const raw = {
      company: { value: 'Acme Ltd', quote: 'Acme Ltd will invest' },
      signal: { value: 'initiative_budget', quote: 'will invest Rs 12 crore' },
      beneficiary: { value: 'dropouts_first_gen', quote: 'skill school dropouts in Pune' },
      scale_cr: { value: 120, quote: 'Rs 120 crore' }, // quote not in text
      deadline: { value: '2026-11-30', quote: 'Applications close on 30 November 2026' },
      geography: { value: 'mars', quote: 'in Pune' }, // invalid enum value
    } as never;
    const e = verifyExtraction(raw, text, 'm');
    expect(e.company.tag).toBe('quoted');
    expect(e.beneficiary.value).toBe('dropouts_first_gen');
    expect(e.scale_cr.tag).toBe('not_stated');
    expect(e.scale_cr.value).toBeNull();
    expect(e.rejected_quotes).toContain('scale_cr');
    expect(e.geography.tag).toBe('not_stated');
    expect(e.deadline.value).toBe('2026-11-30');
  });
  it('matches quotes despite case, curly quotes and whitespace', () => {
    const e = verifyExtraction({ company: { value: 'Acme', quote: 'ACME   LTD will invest' } } as never, text, 'm');
    expect(e.company.tag).toBe('quoted');
  });
  it('rejects an invalid date even with a real quote', () => {
    const e = verifyExtraction({ deadline: { value: '30/11/2026', quote: 'Applications close on 30 November 2026' } } as never, text, 'm');
    expect(e.deadline.tag).toBe('not_stated');
  });
  it('relevance pre-filter needs a CSR cue and a topic cue', () => {
    expect(looksRelevant({ title: 'Acme CSR skilling programme', text: '' })).toBe(true);
    expect(looksRelevant({ title: 'Acme quarterly profit', text: 'revenue rose' })).toBe(false);
  });
});

describe('extractBatch (G8 quota handling)', () => {
  const mk = (id: string) => art(id, strongEx(), { text: 'Acme Ltd will invest Rs 12 crore to skill school dropouts in Pune.', extraction: null });
  it('stops on a quota error, keeps the rest queued and does not loop', async () => {
    let calls = 0;
    const model: JsonModel = { name: 'm', generateJson: async () => { calls++; throw new QuotaError(60); } };
    const r = await extractBatch(model, ['a', 'b', 'c', 'd', 'e', 'f'].map(mk));
    expect(r.quotaHit).toBe(true);
    expect(r.quotaRetryAfter).toBe(60);
    expect(calls).toBe(1);
    expect(r.failed.length).toBe(6);
    expect(r.done.size).toBe(0);
  });
  it('maps results back by article id', async () => {
    const arts = ['a', 'b'].map(mk);
    const model: JsonModel = {
      name: 'm',
      generateJson: async () => arts.map((a) => ({ id: a.id, company: { value: 'Acme Ltd', quote: 'Acme Ltd will invest' } })),
    };
    const r = await extractBatch(model, arts);
    expect(r.done.size).toBe(2);
    expect(r.done.get(arts[0].id)!.company.tag).toBe('quoted');
  });
});

describe('draft (C4, G9)', () => {
  const opp = buildOpportunities({ articles: [art('a', strongEx(), { text: 't' })], companies: [], settings: settings(), events: [], now: NOW })[0];
  it('warns about numbers and legal claims that are not in the facts', () => {
    expect(draftWarnings('We saw Rs 99 crore', 'Scale quote: Rs 12 crore')).toHaveLength(1);
    expect(draftWarnings('You are obliged to spend', 'x').length).toBe(1);
    expect(draftWarnings('Could we have a 20 minute call?', 'x')).toHaveLength(0);
  });
  it('creates a draft row and sends nothing', async () => {
    const model: JsonModel = { name: 'm', generateJson: async () => ({ subject: 'Hello', body: 'Hi team, we noticed your programme. Ananya' }) };
    const d = await generateDraft(model, opp, NOW);
    expect(d.cluster_id).toBe(opp.id);
    expect(d.subject).toBe('Hello');
    expect(d.warnings).toEqual([]);
  });
  it('rejects an empty draft', async () => {
    const model: JsonModel = { name: 'm', generateJson: async () => ({ subject: '', body: '' }) };
    await expect(generateDraft(model, opp, NOW)).rejects.toThrow();
  });
});

describe('source credibility classes', () => {
  it('classifies press, wires, blogs and company domains', () => {
    expect(classifySource('livemint.com')).toBe('major_press');
    expect(classifySource('prnewswire.com')).toBe('official');
    expect(classifySource('someone.medium.com')).toBe('blog');
    expect(classifySource('acmeindustries.com', 'acme industries')).toBe('official');
    expect(classifySource('localpaper.in')).toBe('regional_trade');
  });
  it('unused q helper stays exported', () => expect(q(1).tag).toBe('quoted'));
});
