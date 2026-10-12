-- CSR Partnership Radar schema. Run once in the Supabase SQL editor or with `supabase db push`.
-- Access is through the server using the service role key only. Row level security is on with no policies,
-- so the anon and authenticated roles can read and write nothing.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists companies (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists articles (
  id text primary key,                    -- sha1 of the normalised url
  url text not null,
  title text not null,
  publisher text,
  publisher_domain text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  source text not null,                   -- google_news | gdelt | seed
  text text not null default '',
  text_kind text not null default 'snippet_only',
  extraction jsonb,
  extraction_attempts int not null default 0
);
create index if not exists articles_first_seen_idx on articles (first_seen_at desc);
create index if not exists articles_published_idx on articles (published_at desc);
create index if not exists articles_unextracted_idx on articles (first_seen_at desc) where extraction is null;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  cluster_id text not null,
  kind text not null,
  payload jsonb,
  at timestamptz not null default now()
);
create index if not exists events_cluster_idx on events (cluster_id, at);
create index if not exists events_kind_idx on events (kind, at desc);

create table if not exists drafts (
  cluster_id text primary key,
  subject text not null,
  body text not null,
  model text not null,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists digests (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  week_start date not null,
  status text not null check (status in ('pending','sent','failed')),
  variant text not null,
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (recipient, week_start)          -- one digest per recipient per week, enforced by the database
);

create table if not exists run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                   -- running | succeeded | partial | failed | locked
  reviewed int not null default 0,
  extracted int not null default 0,
  queued int not null default 0,
  sources jsonb not null default '[]',
  notes jsonb not null default '[]',
  trigger text not null default 'manual'
);
create index if not exists run_log_started_idx on run_log (started_at desc);
-- at most one run in the running state at a time (the lock)
create unique index if not exists run_log_one_running on run_log ((status)) where status = 'running';

alter table settings enable row level security;
alter table companies enable row level security;
alter table articles enable row level security;
alter table events enable row level security;
alter table drafts enable row level security;
alter table digests enable row level security;
alter table run_log enable row level security;
