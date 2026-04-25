create extension if not exists pgcrypto;
create extension if not exists vector;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_user_id uuid not null references users(id),
  plan text not null default 'free',
  monthly_transcription_seconds_limit int not null default 7200,
  credits_balance int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table watches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by_user_id uuid not null references users(id),
  name text not null,
  type text not null check (type in ('topic', 'podcast', 'entity', 'mixed')),
  query text not null,
  output_language text not null default 'zh-CN',
  source_scope jsonb not null default '{}',
  include_terms text[] not null default '{}',
  exclude_terms text[] not null default '{}',
  expanded_terms text[] not null default '{}',
  min_relevance_score numeric(4,3) not null default 0.650,
  frequency text not null default 'daily' check (frequency in ('realtime', 'daily', 'weekly')),
  backfill_days int not null default 30,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  type text not null check (type in ('rss', 'listennotes', 'xiaoyuzhou', 'apple', 'spotify', 'youtube', 'manual')),
  url text not null,
  canonical_url text,
  external_id text,
  title text,
  author text,
  language text,
  image_url text,
  metadata jsonb not null default '{}',
  auth_mode text not null default 'public',
  last_checked_at timestamptz,
  status text not null default 'active' check (status in ('active', 'degraded', 'blocked', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, external_id, url)
);

create table watch_sources (
  watch_id uuid not null references watches(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watch_id, source_id)
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  guid text,
  title text not null,
  description text,
  published_at timestamptz,
  duration_sec int,
  audio_url text,
  page_url text not null,
  image_url text,
  language text,
  checksum text,
  metadata jsonb not null default '{}',
  status text not null default 'discovered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index episodes_guid_source_idx on episodes (source_id, guid) where guid is not null;
create unique index episodes_audio_checksum_idx on episodes (checksum) where checksum is not null;
create index episodes_published_at_idx on episodes (published_at desc);

create table episode_matches (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references watches(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  trigger_type text not null,
  metadata_score numeric(4,3),
  semantic_score numeric(4,3),
  final_score numeric(4,3),
  decision text not null check (decision in ('skip', 'sample', 'process')),
  reason text,
  created_at timestamptz not null default now(),
  unique (watch_id, episode_id)
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  provider text not null,
  model text not null,
  language text,
  object_key text,
  segments jsonb not null,
  speaker_count int,
  confidence numeric(4,3),
  duration_sec int,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  unique (episode_id, provider, model)
);

create table episode_segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  transcript_id uuid references transcripts(id) on delete cascade,
  index int not null,
  start_sec int not null,
  end_sec int not null,
  title text,
  summary text,
  text_excerpt text,
  embedding vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (episode_id, index)
);

create table episode_summaries (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  output_language text not null,
  one_liner text not null,
  overview text,
  chapters jsonb not null default '[]',
  worth_listening jsonb not null default '{}',
  entities jsonb not null default '[]',
  prompt_version text not null,
  model text not null,
  quality_status text not null default 'unchecked',
  created_at timestamptz not null default now(),
  unique (episode_id, output_language, prompt_version)
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  watch_id uuid not null references watches(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  segment_id uuid references episode_segments(id) on delete set null,
  claim text not null,
  evidence_excerpt text not null,
  reasoning text,
  implication text,
  timestamp_start_sec int not null,
  timestamp_end_sec int not null,
  entities jsonb not null default '[]',
  relevance_score numeric(4,3) not null,
  confidence numeric(4,3) not null,
  groundedness_score numeric(4,3),
  output_language text not null default 'zh-CN',
  status text not null default 'published' check (status in ('draft', 'published', 'suppressed', 'retracted')),
  prompt_version text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table insight_feedback (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid not null references insights(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  feedback text not null check (feedback in ('save', 'share', 'playback', 'irrelevant', 'wrong', 'important')),
  note text,
  created_at timestamptz not null default now()
);

create table briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  watch_id uuid references watches(id) on delete cascade,
  type text not null check (type in ('daily', 'weekly', 'manual')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  title text not null,
  summary text not null,
  insight_ids uuid[] not null default '{}',
  output_language text not null default 'zh-CN',
  status text not null default 'draft' check (status in ('draft', 'published', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{brief.published,insight.published}',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'queued',
  dedupe_key text,
  payload jsonb not null,
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index jobs_dedupe_key_idx on jobs (dedupe_key) where dedupe_key is not null;

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  provider text,
  model text,
  episode_id uuid references episodes(id) on delete set null,
  seconds int,
  input_tokens int,
  output_tokens int,
  credits_charged int not null default 0,
  cost_usd numeric(10,4),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

