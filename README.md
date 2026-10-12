# CSR Partnership Radar

A weekly CSR intelligence digest for the Head of Corporate Partnerships at a Pune education and skilling NGO.
It finds corporate CSR signals, checks them against fixed gates, scores them against a 100-point rubric, and tells the reader one of three things per company: **Call this week**, **Watch**, or **Skip**. Policy updates are shown separately and are never scored. Every score shows the quote that supports it. The tool drafts outreach emails but **never sends one**. The only email it sends is the Monday 7:00 AM IST digest.

## What it does

1. **Collects** items from Google News RSS (primary), GDELT (backup) and a seeded set of real items (fallback).
2. **Extracts** structured fields with Gemini Flash. Each field must carry a supporting quote that appears in the source text. If the quote is not found, the field is treated as "not stated" and scores zero.
3. **Checks gates** before any scoring: NGO readiness, Schedule VII fit, company Section 135 applicability, exclusions. Each is Passed, Failed or Unknown.
4. **Scores in plain code** (not by the model): signal 25, beneficiary 20, sector 10, geography 15, scale 10, recency 10, source credibility 5, actionability 5.
   Call needs 55 or more, Watch 30 to 54, Emerging 15 to 29 (shown, but not a reason to call), Skip below 15. A partner search that passes the gates is a Call.
5. **Windows**: main digest shows items 0 to 7 days old. Late finds (8 to 21 days old, never shown before, fresh score of 80 or more, at most 3) are listed separately. Open calls stay eligible until their deadline.
6. **Shows** one ranked list (Call, then Watch), policy updates separately, and "Closing before next Monday" at the top.
7. **Drafts** an outreach email when the user taps Pursue. The user copies it or opens it in their own mail app.

## Screens

Priorities, Companies (company-level eligibility list and manual contacts), Settings, System health.

## Defaults I chose where the brief was silent

These are easy to change in `src/lib/config.ts` and `/settings`.

- Fit floor: an item with fewer than 6 beneficiary points cannot be a Call; it is capped at Watch.
- Unknown Schedule VII caps the verdict at Watch. Unknown Section 135 may still reach Call, with a "verify" step in the next action.
- An existing relationship earns the 5 actionability points, shows a badge and sorts first within its band (maximum +5). It can never beat a failed gate or the fit floor.
- Open-call reminders sit outside the late-find cap of 3.
- Vercel Hobby allows one cron run per day, so the cron fires daily at 06:00 IST (`30 0 * * *` UTC). Monday sends the digest. Tuesday or Wednesday only send if Monday's digest never went out, and they are marked "Delayed". Other days do nothing. Hobby cron can fire up to about an hour late, so the digest may not land at exactly 7:00 AM.

## Run it locally

```bash
npm install
npm test            # 74 tests
npm run dev
```

With no environment variables set, the app starts in **demo mode**: no database, the seeded real items, a fixed "now" equal to the seed date, and a visible banner. Writes work in memory only and are lost on restart.

## Deploy

1. **Neon**: create a Neon Postgres project and copy its connection string (or add the Neon integration from the Vercel Storage tab, which sets `DATABASE_URL` for you). The app creates its own tables on first use; `db/schema.sql` holds the same statements.
2. **GitHub**: push this folder to a public repository.
3. **Vercel**: import the repository. Framework is detected as Next.js. `vercel.json` registers the cron.
4. **Environment variables** (Vercel project settings, never in the repo):

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Without it, the app stays in demo mode. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction and drafts. Default model `gemini-flash-latest`. |
| `LUSHA_API_KEY` | Optional. Turns on the "Find their phone and email" lookup on the Outreach page (Lusha Person API v2, one named person per click, nothing stored). |
| `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO` | The Monday digest. `DIGEST_FROM` must be a sender verified in Resend. |
| `APP_URL` | Public URL, used for links in the email. |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer` to the cron route. |
| `ALLOW_OPEN_WRITES` | Set to `true` to allow Run now, Pursue, Companies and Settings without a password (demo mode on a public URL). Anyone with the link can then trigger a run and use Gemini quota. Prefer `APP_PASSWORD` for real use. |
| `APP_PASSWORD` | Protects the whole app with a password (Basic auth). If it is unset in production, every write returns 403 and the site is read-only. |

5. Open **System health** and press **Run now** once. Confirm each source shows a count or a plain error message.
6. Send yourself a test digest before relying on the Monday run.

## Architecture in brief

- `src/lib/scoring.ts`, `checks.ts`, `verdict.ts`: pure functions, no network. This is where every rule lives.
- `src/lib/opportunities.ts`: clustering of articles into opportunities, list selection, next-action text.
- `src/lib/extract.ts`, `gemini.ts`, `draft.ts`: Gemini calls. Batches of 4 articles, JSON schema, temperature 0, quote verification. If the quota is hit, the batch stops and the remaining items stay queued.
- `src/lib/sources/`: Google News RSS, GDELT, article body fetch (respects robots.txt).
- `src/lib/pipeline.ts`: one run, with a lock so two runs cannot overlap.
- `src/lib/digest.ts`: builds and sends the digest. This is the only file that talks to Resend, and `weekly.ts` is the only caller. Tests enforce both. The send is idempotent: a database unique key on (recipient, week) plus a Resend idempotency key.
- `src/lib/repo/`: one interface, a Neon Postgres adapter and an in-memory adapter.

## Known limitations (read before trusting it)

- **Not yet exercised live**: the Neon adapter (its SQL was checked against a local Postgres 16), Gemini, Resend, Google News and GDELT were developed against test doubles and recorded samples. The `gemini-flash-latest` alias, the Google News `when:` operator and the GDELT query syntax are unverified until the first deployed run.
- **Google News links redirect**, so full article text is often unavailable and the extraction falls back to the headline and snippet. With headline-only evidence the app rarely reaches Call, and it says so through the evidence confidence label. This is deliberate: a Call needs quoted support.
- **Seed data** is 9 real items gathered from public sources on 12 Oct 2026 and labelled as medium trust. They are there so the app has something real to show if every live source fails.
- **Apollo** (contact enrichment) is deferred. There is no LinkedIn scraping. Contacts are entered by hand.
- Hobby cron timing is approximate, as described above.
- A company's CSR spend or deadlines are never invented. If a value is not in a quote, it shows as "not stated".
