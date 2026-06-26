import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export type PodcastNoteDb = Database;

const initialMigrationPath = resolve("packages/db/sqlite/0001_initial.sql");

export function openPodcastNoteDb(path = process.env["PODCAST_NOTE_DB_PATH"] ?? "storage/podcast-note.sqlite"): PodcastNoteDb {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.exec("pragma foreign_keys = on;");
  migrate(db);
  return db;
}

export function migrate(db: PodcastNoteDb): void {
  db.exec("pragma foreign_keys = on;");
  db.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at text not null default (datetime('now'))
    );
  `);

  const version = "0001_initial";
  const existing = db.query("select version from schema_migrations where version = ?").get(version);
  if (existing) {
    ensureM1WorkspaceSchema(db);
    ensureProcessingStatusSchema(db);
    ensureLarkAuthSchema(db);
    ensureWikiSchema(db);
    return;
  }

  const sql = readFileSync(initialMigrationPath, "utf8");
  const apply = db.transaction(() => {
    db.exec(sql);
    db.query("insert into schema_migrations (version) values (?)").run(version);
  });
  apply();
  ensureM1WorkspaceSchema(db);
  ensureProcessingStatusSchema(db);
  ensureLarkAuthSchema(db);
  ensureWikiSchema(db);
}

function ensureM1WorkspaceSchema(db: PodcastNoteDb): void {
  db.exec(`
    create table if not exists users (
      id text primary key,
      email text unique,
      name text,
      timezone text not null default 'Asia/Shanghai',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists workspaces (
      id text primary key,
      owner_user_id text not null references users(id) on delete cascade,
      name text not null,
      type text not null default 'personal' check (type in ('personal')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (owner_user_id, type)
    );

    create table if not exists watch_polls (
      id text primary key,
      watch_id text not null references watches(id) on delete cascade,
      checked_at text not null,
      status text not null check (status in ('completed', 'failed')),
      candidate_count integer not null default 0,
      queued_count integer not null default 0,
      error text,
      created_at text not null default (datetime('now'))
    );

    create index if not exists watch_polls_watch_checked_idx
      on watch_polls (watch_id, checked_at desc);

    create table if not exists episode_processing_jobs (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      watch_id text not null references watches(id) on delete cascade,
      episode_id text not null references episodes(id) on delete cascade,
      source_url text not null,
      status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
      attempts integer not null default 0,
      relevance_score real,
      relevance_reason_json text not null default '{}',
      processing_run_id text references processing_runs(id) on delete set null,
      error text,
      queued_at text not null default (datetime('now')),
      started_at text,
      finished_at text,
      updated_at text not null default (datetime('now')),
      unique (workspace_id, watch_id, episode_id)
    );

    create index if not exists episode_processing_jobs_status_queued_idx
      on episode_processing_jobs (status, queued_at);
    create index if not exists episode_processing_jobs_workspace_status_idx
      on episode_processing_jobs (workspace_id, status, queued_at);

    create table if not exists daily_briefs (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      brief_date text not null,
      timezone text not null default 'Asia/Shanghai',
      status text not null check (status in ('sent', 'failed', 'skipped')),
      insight_count integer not null default 0,
      subject text,
      provider_message_id text,
      error text,
      sent_at text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (workspace_id, user_id, brief_date)
    );

    create index if not exists daily_briefs_workspace_date_idx
      on daily_briefs (workspace_id, brief_date desc);

    create table if not exists insight_feedback (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      insight_id text not null references insights(id) on delete cascade,
      action text not null check (action in ('saved', 'irrelevant', 'wrong', 'archived')),
      note text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (workspace_id, user_id, insight_id)
    );

    create index if not exists insight_feedback_workspace_action_idx
      on insight_feedback (workspace_id, action, updated_at desc);

    create table if not exists sessions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      workspace_id text not null references workspaces(id) on delete cascade,
      token text not null unique,
      created_at text not null,
      expires_at text not null,
      revoked_at text
    );

    create index if not exists sessions_user_idx
      on sessions (user_id, expires_at desc);
    create index if not exists sessions_workspace_idx
      on sessions (workspace_id, expires_at desc);

    create table if not exists usage_events (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      session_id text references sessions(id) on delete set null,
      event_type text not null check (event_type in ('view', 'save', 'irrelevant', 'wrong', 'playback', 'open_email')),
      entity_type text not null check (entity_type in ('inbox', 'episode', 'insight', 'brief', 'watch')),
      entity_id text,
      metadata_json text not null default '{}',
      occurred_at text not null,
      created_at text not null default (datetime('now'))
    );

    create index if not exists usage_events_workspace_time_idx
      on usage_events (workspace_id, occurred_at desc);
    create index if not exists usage_events_user_time_idx
      on usage_events (user_id, occurred_at desc);
  `);

  ensureColumn(db, "watches", "enabled", "integer not null default 1");
}

function ensureColumn(db: PodcastNoteDb, table: string, column: string, definition: string): void {
  const columns = db.query(`pragma table_info(${table})`).all() as Array<Record<string, unknown>>;
  if (columns.some((row) => row["name"] === column)) return;
  db.exec(`
    alter table ${table} add column ${column} ${definition};
  `);
}

function ensureProcessingStatusSchema(db: PodcastNoteDb): void {
  db.exec(`
    create table if not exists processing_episode_statuses (
      run_id text not null references processing_runs(id) on delete cascade,
      episode_id text not null references episodes(id) on delete cascade,
      source_url text not null,
      stage text not null check (stage in ('resolved', 'transcribing', 'transcribed', 'analyzing', 'analyzed', 'exported', 'failed')),
      status text not null check (status in ('running', 'completed', 'failed')),
      error text,
      updated_at text not null default (datetime('now')),
      primary key (run_id, episode_id)
    );

    create index if not exists processing_episode_statuses_episode_idx
      on processing_episode_statuses (episode_id, updated_at desc);
  `);
}

function ensureLarkAuthSchema(db: PodcastNoteDb): void {
  db.exec(`
    create table if not exists lark_bind_sessions (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      agent_id text not null,
      state_hash text not null unique,
      permission_package text not null,
      terminal_fingerprint text,
      status text not null check (status in ('pending', 'completed', 'expired', 'failed')),
      connection_id text,
      verification_url text not null,
      expires_at text not null,
      created_at text not null,
      completed_at text,
      error text
    );

    create index if not exists lark_bind_sessions_workspace_created_idx
      on lark_bind_sessions (workspace_id, created_at desc);

    create table if not exists lark_connections (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      agent_id text not null,
      tenant_key text not null,
      open_id text not null,
      union_id text,
      user_name text,
      permission_package text not null,
      encrypted_access_token text not null,
      encrypted_refresh_token text not null,
      access_token_expires_at text not null,
      refresh_token_expires_at text,
      status text not null default 'active' check (status in ('active', 'reauth_required', 'revoked')),
      created_at text not null,
      updated_at text not null,
      revoked_at text
    );

    create index if not exists lark_connections_workspace_updated_idx
      on lark_connections (workspace_id, updated_at desc);

    create table if not exists lark_bot_installations (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      app_id text not null,
      tenant_key text not null,
      chat_id text not null,
      chat_name text,
      operator_open_id text,
      status text not null default 'active' check (status in ('active', 'disabled')),
      installed_at text not null,
      updated_at text not null,
      disabled_at text,
      unique(workspace_id, app_id, chat_id)
    );

    create index if not exists lark_bot_installations_workspace_updated_idx
      on lark_bot_installations (workspace_id, updated_at desc);

    create table if not exists lark_delivery_records (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      watch_id text references watches(id) on delete cascade,
      episode_id text references episodes(id) on delete cascade,
      chat_id text not null,
      delivery_type text not null check (delivery_type in ('episode_summary', 'wiki_pending_proposal_summary')),
      delivery_key text,
      provider_message_id text not null,
      delivered_at text not null,
      unique(workspace_id, watch_id, episode_id, chat_id, delivery_type)
    );

    create index if not exists lark_delivery_records_workspace_delivered_idx
      on lark_delivery_records (workspace_id, delivered_at desc);

    create table if not exists lark_pending_intents (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      chat_id text not null,
      sender_open_id text,
      intent_type text not null,
      intent_json text not null,
      status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'expired')),
      expires_at text not null,
      created_at text not null,
      completed_at text,
      error text
    );

    create index if not exists lark_pending_intents_chat_status_idx
      on lark_pending_intents (workspace_id, chat_id, status, created_at desc);
  `);
  migrateLarkDeliveryRecordsForProposalSummary(db);
  db.exec(`
    create unique index if not exists lark_delivery_records_workspace_chat_key_idx
      on lark_delivery_records (workspace_id, chat_id, delivery_type, delivery_key)
      where delivery_key is not null;
  `);
}

function migrateLarkDeliveryRecordsForProposalSummary(db: PodcastNoteDb): void {
  const table = db.query("select sql from sqlite_master where type = 'table' and name = 'lark_delivery_records'").get() as { sql?: string } | null;
  const columns = db.query("pragma table_info(lark_delivery_records)").all() as Array<{ name: string }>;
  const hasDeliveryKey = columns.some((column) => column.name === "delivery_key");
  const supportsProposalSummary = table?.sql?.includes("wiki_pending_proposal_summary") ?? false;
  const hasNullableEpisodeScope = table?.sql?.includes("watch_id text references") ?? false;
  if (hasDeliveryKey && supportsProposalSummary && hasNullableEpisodeScope) return;
  db.exec(`
    pragma foreign_keys = off;
    create table if not exists lark_delivery_records_next (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      watch_id text references watches(id) on delete cascade,
      episode_id text references episodes(id) on delete cascade,
      chat_id text not null,
      delivery_type text not null check (delivery_type in ('episode_summary', 'wiki_pending_proposal_summary')),
      delivery_key text,
      provider_message_id text not null,
      delivered_at text not null,
      unique(workspace_id, watch_id, episode_id, chat_id, delivery_type)
    );

    insert or ignore into lark_delivery_records_next (
      id, workspace_id, watch_id, episode_id, chat_id, delivery_type, delivery_key, provider_message_id, delivered_at
    )
    select id, workspace_id, watch_id, episode_id, chat_id, delivery_type, null, provider_message_id, delivered_at
    from lark_delivery_records;

    drop table lark_delivery_records;
    alter table lark_delivery_records_next rename to lark_delivery_records;
    create index if not exists lark_delivery_records_workspace_delivered_idx
      on lark_delivery_records (workspace_id, delivered_at desc);
    create unique index if not exists lark_delivery_records_workspace_chat_key_idx
      on lark_delivery_records (workspace_id, chat_id, delivery_type, delivery_key)
      where delivery_key is not null;
    pragma foreign_keys = on;
  `);
}

function ensureWikiSchema(db: PodcastNoteDb): void {
  db.exec(`
    create table if not exists wiki_exports (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      vault_root text not null,
      episode_id text references episodes(id) on delete cascade,
      watch_id text references watches(id) on delete set null,
      export_type text not null check (export_type in ('source_note', 'brief', 'proposal', 'wiki_page', 'lark_doc')),
      file_path text not null,
      content_hash text not null,
      status text not null check (status in ('written', 'skipped', 'failed')),
      error text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (workspace_id, export_type, file_path)
    );

    create index if not exists wiki_exports_workspace_updated_idx
      on wiki_exports (workspace_id, updated_at desc);
    create index if not exists wiki_exports_episode_idx
      on wiki_exports (episode_id, export_type);

    create table if not exists wiki_update_proposals (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      episode_id text not null references episodes(id) on delete cascade,
      insight_id text references insights(id) on delete cascade,
      target_path text not null,
      proposal_type text not null check (proposal_type in ('create_page', 'append_evidence', 'revise_summary', 'refresh_synthesis', 'flag_conflict', 'add_crosslink', 'mark_stale', 'mark_deprecated', 'archive_page')),
      title text not null,
      rationale text not null,
      patch_json text not null,
      status text not null check (status in ('pending', 'approved', 'applied', 'rejected', 'failed')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists wiki_update_proposals_workspace_status_idx
      on wiki_update_proposals (workspace_id, status, updated_at desc);
    create index if not exists wiki_update_proposals_episode_idx
      on wiki_update_proposals (episode_id, status);

    create table if not exists wiki_pages (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      vault_root text not null,
      path text not null,
      page_type text not null check (page_type in ('concept', 'entity', 'claim', 'source', 'brief')),
      title text not null,
      status text not null check (status in ('active', 'stale', 'contested', 'deprecated', 'archived')),
      source_count integer not null default 0,
      confidence_score real not null default 0,
      freshness_score real not null default 1,
      contradiction_count integer not null default 0,
      last_supported_at text,
      last_contradicted_at text,
      last_reviewed_at text,
      content_hash text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (workspace_id, vault_root, path)
    );

    create index if not exists wiki_pages_workspace_status_idx
      on wiki_pages (workspace_id, status, updated_at desc);
    create index if not exists wiki_pages_workspace_type_idx
      on wiki_pages (workspace_id, page_type, updated_at desc);

    create table if not exists wiki_page_evidence (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      page_id text not null references wiki_pages(id) on delete cascade,
      insight_id text not null references insights(id) on delete cascade,
      episode_id text not null references episodes(id) on delete cascade,
      watch_id text references watches(id) on delete set null,
      support_type text not null check (support_type in ('supporting', 'contradicting', 'context')),
      claim text not null,
      evidence_excerpt text not null,
      timestamp_start_sec real,
      timestamp_end_sec real,
      confidence real not null default 0,
      groundedness_score real not null default 0,
      observed_at text not null,
      created_at text not null default (datetime('now')),
      unique (page_id, insight_id, support_type)
    );

    create index if not exists wiki_page_evidence_workspace_idx
      on wiki_page_evidence (workspace_id, created_at desc);
    create index if not exists wiki_page_evidence_page_idx
      on wiki_page_evidence (page_id, support_type);
    create index if not exists wiki_page_evidence_insight_idx
      on wiki_page_evidence (insight_id);
  `);
  ensureWikiProposalTypeSchema(db);
}

function ensureWikiProposalTypeSchema(db: PodcastNoteDb): void {
  const row = db.query(`
    select sql from sqlite_master where type = 'table' and name = 'wiki_update_proposals'
  `).get() as { sql?: string } | null;
  if (!row?.sql || row.sql.includes("refresh_synthesis")) return;
  db.exec(`
    pragma foreign_keys = off;
    create table if not exists wiki_update_proposals_next (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      episode_id text not null references episodes(id) on delete cascade,
      insight_id text references insights(id) on delete cascade,
      target_path text not null,
      proposal_type text not null check (proposal_type in ('create_page', 'append_evidence', 'revise_summary', 'refresh_synthesis', 'flag_conflict', 'add_crosslink', 'mark_stale', 'mark_deprecated', 'archive_page')),
      title text not null,
      rationale text not null,
      patch_json text not null,
      status text not null check (status in ('pending', 'approved', 'applied', 'rejected', 'failed')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );
    insert or ignore into wiki_update_proposals_next (
      id, workspace_id, episode_id, insight_id, target_path, proposal_type,
      title, rationale, patch_json, status, created_at, updated_at
    )
    select
      id, workspace_id, episode_id, insight_id, target_path, proposal_type,
      title, rationale, patch_json, status, created_at, updated_at
    from wiki_update_proposals;
    drop table wiki_update_proposals;
    alter table wiki_update_proposals_next rename to wiki_update_proposals;
    create index if not exists wiki_update_proposals_workspace_status_idx
      on wiki_update_proposals (workspace_id, status, updated_at desc);
    create index if not exists wiki_update_proposals_episode_idx
      on wiki_update_proposals (episode_id, status);
    pragma foreign_keys = on;
  `);
}
