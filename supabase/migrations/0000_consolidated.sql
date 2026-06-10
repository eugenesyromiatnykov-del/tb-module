-- Consolidated migration: replaces 0001–0018 with a single fresh-start script.
-- Use this on a NEW Supabase project instead of running 18 migrations in order.
-- Produces the same final schema as 0001 → 0018 in sequence, but without:
--   • the tb_status enum dance ('observed'/'contact'/'cleared'/'external'
--     added in 0005/0001 and later abandoned by 0007 — PG can't drop enum
--     values, and using a newly-added enum value in the same transaction
--     fails with 55P04 "unsafe use of new value")
--   • intermediate patient_dashboard view rebuilds (we go straight to the
--     final 0015 column set)
--   • 0017's regex backfill of village (no data to backfill on a fresh DB)
--
-- After this runs, the schema is identical to what 0001 → 0018 would
-- produce. Numbering 0000 so existing migrations 0001–0018 stay in repo
-- for history, but on a fresh DB you only run THIS file.

-- Note: this consolidated migration does NOT yet include the multi-tenant
-- 0019 changes (doctors table + doctor_id columns). Until folded in, a
-- fresh deploy needs to run THIS file first, then 0019_multi_tenant.sql
-- separately (insert Doctor 1 between Part 1 and Part 2 — see comments
-- in that file).

-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── ENUMS ───────────────────────────────────────────────────────────────────
-- tb_status: includes legacy values 'contact'/'cleared'/'external'/
-- 'observed' even though no current code writes them. They MUST exist
-- in the enum because /api/patients applies a default `.neq('tb_status',
-- 'cleared')` filter to hide cleared-status rows on the registry list —
-- if 'cleared' isn't a valid enum value, the filter throws 22P02
-- "invalid input value for enum tb_status: cleared". Same for any other
-- code path that still mentions these values for backward compat.
do $$ begin
  create type tb_status as enum ('risk', 'detected', 'contact', 'cleared', 'external', 'observed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fluoro_result_code as enum ('normal', 'pathology', 'pending', 'refused', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sputum_test_type as enum ('xpert', 'microscopy', 'culture', 'pcr');
exception when duplicate_object then null; end $$;

do $$ begin
  create type questionnaire_result as enum ('low_risk', 'needs_xray', 'needs_referral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type data_source as enum ('manual', 'extension', 'imported_xlsx', 'mis_sync');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quantiferon_result_code as enum ('positive', 'negative', 'indeterminate', 'unknown');
exception when duplicate_object then null; end $$;

-- ── LOCATIONS ───────────────────────────────────────────────────────────────
create table if not exists locations (
  id   text primary key,
  name text not null
);
insert into locations (id, name) values
  ('bilohirska', 'Білогірська амбулаторія'),
  ('zaluzhe',    'Залужжя')
on conflict (id) do nothing;

-- ── PATIENTS (with all columns added through 0015) ──────────────────────────
create table if not exists patients (
  id                          uuid primary key default uuid_generate_v4(),
  medics_id                   text unique,
  surname                     text not null,
  first_name                  text not null,
  patronymic                  text,
  birth_date                  date not null,
  gender                      char(1) check (gender in ('M','F')),
  phone                       text,
  address                     text,
  village                     text,                     -- 0011
  location_id                 text references locations(id) on delete set null,

  tb_status                   tb_status not null default 'risk',
  contact_of                  uuid references patients(id) on delete set null,

  medical_risk_groups         text[] not null default '{}',
  social_risk_groups          text[] not null default '{}',

  diagnoses_codes             text[] not null default '{}',
  diagnoses_detail            jsonb not null default '[]'::jsonb,  -- 0012
  diagnoses_synced_at         timestamptz,

  last_indicators_synced_at   timestamptz,             -- 0015
  last_analysis_snapshot      jsonb,                   -- 0015

  notes                       text,
  archived                    boolean not null default false,
  archived_reason             text,
  archived_at                 timestamptz,

  is_external                 boolean not null default false,  -- 0006

  -- АДП-М tracking, 0010
  adpm_contraindication        boolean not null default false,
  adpm_contraindication_reason text,
  adpm_refused                 boolean not null default false,
  adpm_refusal_date            date,
  adpm_refusal_photo_path      text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint adpm_flags_exclusive check (not (adpm_contraindication and adpm_refused))
);

create index if not exists patients_search        on patients (lower(surname), birth_date);
create index if not exists patients_medics        on patients (medics_id) where medics_id is not null;
create index if not exists patients_active        on patients (tb_status) where archived = false;
create index if not exists patients_location      on patients (location_id) where archived = false;
create index if not exists patients_med_groups    on patients using gin (medical_risk_groups);
create index if not exists patients_soc_groups    on patients using gin (social_risk_groups);
create index if not exists patients_contact_of    on patients (contact_of) where contact_of is not null;
create index if not exists patients_village       on patients (village);

-- ── FLUOROGRAPHY ────────────────────────────────────────────────────────────
create table if not exists fluorography (
  id                  uuid primary key default uuid_generate_v4(),
  patient_id          uuid not null references patients(id) on delete cascade,
  date                date not null,
  result              text,
  result_code         fluoro_result_code not null default 'unknown',
  next_planned_date   date,
  source              data_source not null default 'manual',
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists fluoro_patient on fluorography (patient_id, date desc);
create index if not exists fluoro_planned on fluorography (next_planned_date) where next_planned_date is not null;

-- ── SPUTUM TESTS ────────────────────────────────────────────────────────────
create table if not exists sputum_tests (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references patients(id) on delete cascade,
  date        date not null,
  result      text,
  test_type   sputum_test_type not null default 'xpert',
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists sputum_patient on sputum_tests (patient_id, date desc);

-- ── QUANTIFERON TESTS (0008) ────────────────────────────────────────────────
create table if not exists quantiferon_tests (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references patients(id) on delete cascade,
  date        date not null,
  result      text,
  result_code quantiferon_result_code not null default 'unknown',
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists quantiferon_patient on quantiferon_tests (patient_id, date desc);

-- ── АДП-М VACCINATIONS (0010) ───────────────────────────────────────────────
create table if not exists adpm_vaccinations (
  id            uuid primary key default uuid_generate_v4(),
  patient_id    uuid not null references patients(id) on delete cascade,
  date          date not null,
  vaccine_name  text,
  manufacturer  text,
  lot_number    text,
  notes         text,
  source        data_source not null default 'manual',
  created_at    timestamptz not null default now()
);
create index if not exists adpm_patient on adpm_vaccinations (patient_id, date desc);

-- ── QUESTIONNAIRES (додаток 9) ──────────────────────────────────────────────
create table if not exists questionnaires (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid references patients(id) on delete set null,
  filled_at   timestamptz not null default now(),
  answers     jsonb not null,
  result      questionnaire_result not null,
  filled_by   text,
  notes       text
);
create index if not exists questionnaires_patient on questionnaires (patient_id);
create index if not exists questionnaires_result  on questionnaires (result, filled_at desc);

-- ── MIS SYNC HISTORY ────────────────────────────────────────────────────────
create table if not exists mis_imports (
  id                   uuid primary key default uuid_generate_v4(),
  imported_at          timestamptz not null default now(),
  imported_by          text,
  filename             text,
  total_in_file        int,
  patients_added       int,
  patients_updated     int,
  patients_archived    int,
  diff_summary         jsonb
);

-- ── AUDIT LOG ───────────────────────────────────────────────────────────────
create table if not exists audit_log (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid references patients(id) on delete set null,
  action      text not null,
  changes     jsonb,
  user_label  text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_patient on audit_log (patient_id, created_at desc);

-- ── ATTACHMENTS ─────────────────────────────────────────────────────────────
create table if not exists attachments (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid references patients(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime_type    text,
  size_bytes   int,
  category     text,
  created_at   timestamptz not null default now()
);
create index if not exists attachments_patient on attachments (patient_id);

-- ── MOZ ORDERS / Накази (0004) ──────────────────────────────────────────────
create table if not exists orders (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  url         text not null,
  notes       text,
  category    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists orders_title on orders (title);

-- ── SYNC_JOBS (0014 + 0016) ─────────────────────────────────────────────────
create table if not exists sync_jobs (
  id                  uuid primary key default uuid_generate_v4(),
  location            text,                              -- 'bilohirska' | 'zaluzhe' | null for "all"
  only_unsynced       boolean not null default true,
  scope               text not null default 'location',  -- 'location' | 'subset' | 'all'
  medics_id_list      text[],
  queue               jsonb not null default '[]'::jsonb,
  cursor              int  not null default 0,
  failed              jsonb not null default '[]'::jsonb,
  current_medics_id   text,
  status              text not null default 'queued',    -- queued|running|paused|stopped|done|error
  started_at          timestamptz,
  last_heartbeat_at   timestamptz,
  stopped_at          timestamptz,
  finished_at         timestamptz,
  error               text,
  owner_device_id     text,                              -- 0016
  owner_device_label  text,                              -- 0016
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists sync_jobs_status_idx on sync_jobs (status, created_at desc);

-- ── INDICATOR RESULTS (0015) ────────────────────────────────────────────────
create table if not exists indicator_results (
  id                    uuid primary key default uuid_generate_v4(),
  patient_id            uuid not null references patients(id) on delete cascade,
  rule_id               text not null,
  rule_name             text,
  rule_category         text,
  rule_type             text,
  applicability_reason  text,
  state                 text not null check (state in ('completed','overdue','partial','not_done')),
  is_overdue            boolean not null default false,
  completed_count       int not null default 0,
  total_count           int not null default 0,
  last_date             date,
  next_date             date,
  frequency_months      int,
  required_actions      jsonb not null default '[]'::jsonb,
  details               jsonb not null default '[]'::jsonb,
  analyzed_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (patient_id, rule_id)
);
create index if not exists indicator_results_patient_idx     on indicator_results (patient_id);
create index if not exists indicator_results_rule_state_idx  on indicator_results (rule_id, state);
create index if not exists indicator_results_analyzed_at_idx on indicator_results (analyzed_at desc);

-- ── HELPERS ─────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create or replace function title_case_uk(s text) returns text as $$
  select case
    when s is null or trim(s) = '' then null
    else upper(left(trim(s), 1)) || lower(substring(trim(s) from 2))
  end;
$$ language sql immutable;

create or replace function patients_derive_village_on_insert() returns trigger as $$
begin
  if new.village is null and new.address is not null then
    new.village := title_case_uk(
      coalesce(
        (regexp_match(new.address, '(?:^|,)\s*с\.\s*([^,]+)', 'i'))[1],
        (regexp_match(new.address, '(?:^|,)\s*смт\.?\s*([^,]+)', 'i'))[1],
        (regexp_match(new.address, '(?:^|,)\s*м\.\s*([^,]+)', 'i'))[1],
        case when new.address !~ ',' then trim(both ' .' from new.address) else null end
      )
    );
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function get_villages() returns table(village text) as $$
  select distinct trim(p.village) as village
  from patients p
  where p.village is not null
    and p.archived = false
    and trim(p.village) <> ''
  order by trim(p.village);
$$ language sql stable;

-- ── TRIGGERS ────────────────────────────────────────────────────────────────
drop trigger if exists patients_updated_at on patients;
create trigger patients_updated_at before update on patients
  for each row execute function set_updated_at();

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

drop trigger if exists sync_jobs_updated_at on sync_jobs;
create trigger sync_jobs_updated_at before update on sync_jobs
  for each row execute function set_updated_at();

drop trigger if exists patients_derive_village on patients;
create trigger patients_derive_village
  before insert or update of address, village on patients
  for each row execute function patients_derive_village_on_insert();

-- ── VIEWS ───────────────────────────────────────────────────────────────────
create or replace view patient_fluoro_summary as
select distinct on (f.patient_id)
  f.patient_id,
  f.date              as last_fluoro_date,
  f.next_planned_date,
  f.result_code       as last_result_code
from fluorography f
order by f.patient_id, f.date desc nulls last;

create or replace view patient_sputum_summary as
select distinct on (s.patient_id)
  s.patient_id,
  s.date           as last_sputum_date,
  s.test_type      as last_sputum_test_type,
  s.result         as last_sputum_result
from sputum_tests s
order by s.patient_id, s.date desc nulls last;

create or replace view patient_quantiferon_summary as
select distinct on (q.patient_id)
  q.patient_id,
  q.date         as last_quantiferon_date,
  q.result_code  as last_quantiferon_result_code,
  q.result       as last_quantiferon_result
from quantiferon_tests q
order by q.patient_id, q.date desc nulls last;

create or replace view patient_adpm_summary as
select distinct on (a.patient_id)
  a.patient_id,
  a.date                                as last_adpm_date,
  (a.date + interval '10 years')::date  as next_adpm_date
from adpm_vaccinations a
order by a.patient_id, a.date desc nulls last;

drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.village, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups,
  p.diagnoses_codes, p.diagnoses_detail, p.diagnoses_synced_at,
  p.last_indicators_synced_at,
  p.last_analysis_snapshot,
  p.notes, p.archived, p.archived_reason, p.archived_at, p.is_external,
  p.created_at, p.updated_at,
  f.last_fluoro_date, f.next_planned_date, f.last_result_code,
  s.last_sputum_date, s.last_sputum_test_type, s.last_sputum_result,
  q.last_quantiferon_date, q.last_quantiferon_result_code, q.last_quantiferon_result,
  a.last_adpm_date, a.next_adpm_date,
  p.adpm_contraindication, p.adpm_contraindication_reason,
  p.adpm_refused, p.adpm_refusal_date, p.adpm_refusal_photo_path
from patients p
left join patient_fluoro_summary       f on f.patient_id = p.id
left join patient_sputum_summary       s on s.patient_id = p.id
left join patient_quantiferon_summary  q on q.patient_id = p.id
left join patient_adpm_summary         a on a.patient_id = p.id;

grant select on patient_dashboard to authenticated;

-- ── ROW-LEVEL SECURITY ──────────────────────────────────────────────────────
-- All writes go through Vercel functions using service_role (bypasses RLS).
-- These policies grant read-only SELECT for the `authenticated` role used by
-- the Realtime gateway (frontend mints a 1h JWT via /api/auth/me?supabase=1).
alter table patients          enable row level security;
alter table fluorography      enable row level security;
alter table sputum_tests      enable row level security;
alter table quantiferon_tests enable row level security;
alter table adpm_vaccinations enable row level security;
alter table questionnaires    enable row level security;
alter table mis_imports       enable row level security;
alter table audit_log         enable row level security;
alter table attachments       enable row level security;
alter table locations         enable row level security;
alter table orders            enable row level security;
alter table sync_jobs         enable row level security;
alter table indicator_results enable row level security;

-- locations is a tiny public reference table — anon can read.
do $$ begin
  create policy locations_read_all on locations for select using (true);
exception when duplicate_object then null; end $$;

-- Authenticated read policies (Realtime needs these).
do $$ begin create policy "auth select patients"          on patients          for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select fluorography"      on fluorography      for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select sputum_tests"      on sputum_tests      for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select quantiferon_tests" on quantiferon_tests for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select adpm_vaccinations" on adpm_vaccinations for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select sync_jobs"         on sync_jobs         for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "auth select indicator_results" on indicator_results for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── REALTIME PUBLICATION ────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table patients;          exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table fluorography;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sputum_tests;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table quantiferon_tests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table adpm_vaccinations; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sync_jobs;         exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table indicator_results; exception when duplicate_object then null; end $$;

-- ── STORAGE BUCKET (0010) ───────────────────────────────────────────────────
-- Private bucket for АДП-М refusal photos — signed URLs from server only.
insert into storage.buckets (id, name, public)
values ('adpm-refusals', 'adpm-refusals', false)
on conflict (id) do nothing;

-- ── GRANTS ──────────────────────────────────────────────────────────────────
grant execute on function get_villages() to service_role;
