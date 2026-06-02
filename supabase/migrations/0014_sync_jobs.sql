-- Sync job table: single source of truth for the extension's batch runner.
-- The TB-module web app creates/controls a job; the Chrome extension polls
-- this row and drives MIS DOM accordingly. Progress (cursor, failed, current
-- patient) is heart-beated back here so the web UI can show it live via
-- Realtime postgres_changes.
--
-- Single-active-job model: at most one job with status IN ('queued',
-- 'running', 'paused', 'stopped') exists at a time. Done/error jobs are
-- kept for history.

create table if not exists sync_jobs (
  id                 uuid primary key default uuid_generate_v4(),

  -- Source spec
  location           text,                              -- 'bilohirska' | 'zaluzhe' | null for "all"
  only_unsynced      boolean not null default true,
  scope              text not null default 'location',  -- 'location' | 'subset' | 'all' (subset = filtered)
  medics_id_list     text[],                            -- for 'subset' scope

  -- Queue + progress
  queue              jsonb not null default '[]'::jsonb, -- [{medics_id, surname, location_id}, ...]
  cursor             int  not null default 0,
  failed             jsonb not null default '[]'::jsonb, -- [{medics_id, surname, reason}, ...]
  current_medics_id  text,

  -- Lifecycle
  status             text not null default 'queued',     -- queued | running | paused | stopped | done | error
  started_at         timestamptz,
  last_heartbeat_at  timestamptz,
  stopped_at         timestamptz,
  finished_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists sync_jobs_status_idx on sync_jobs (status, created_at desc);

drop trigger if exists sync_jobs_updated_at on sync_jobs;
create trigger sync_jobs_updated_at before update on sync_jobs
  for each row execute function set_updated_at();

alter table sync_jobs enable row level security;
-- read-only for authenticated JWT (web app), writes go through service_role.
do $$ begin
  create policy "auth select sync_jobs" on sync_jobs for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Add to supabase_realtime publication for live progress.
do $$ begin
  alter publication supabase_realtime add table sync_jobs;
exception when duplicate_object then null; end $$;
