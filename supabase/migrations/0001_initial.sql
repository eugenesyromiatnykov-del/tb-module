-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── ENUMS ───────────────────────────────────────────────────────────────────
do $$ begin
  create type tb_status as enum ('risk', 'detected', 'contact', 'cleared', 'external', 'archived');
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

-- ── LOCATIONS ───────────────────────────────────────────────────────────────
create table if not exists locations (
  id   text primary key,
  name text not null
);
insert into locations (id, name) values
  ('bilohirska', 'Білогірська амбулаторія'),
  ('zaluzhe',    'Залужжя')
on conflict (id) do nothing;

-- ── PATIENTS ────────────────────────────────────────────────────────────────
create table if not exists patients (
  id                    uuid primary key default uuid_generate_v4(),
  medics_id             text unique,
  surname               text not null,
  first_name            text not null,
  patronymic            text,
  birth_date            date not null,
  gender                char(1) check (gender in ('M','F')),
  phone                 text,
  address               text,
  location_id           text references locations(id) on delete set null,

  tb_status             tb_status not null default 'risk',
  contact_of            uuid references patients(id) on delete set null,

  medical_risk_groups   text[] not null default '{}',
  social_risk_groups    text[] not null default '{}',

  diagnoses_codes       text[] not null default '{}',
  diagnoses_synced_at   timestamptz,

  notes                 text,
  archived              boolean not null default false,
  archived_reason       text,
  archived_at           timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists patients_search        on patients (lower(surname), birth_date);
create index if not exists patients_medics        on patients (medics_id) where medics_id is not null;
create index if not exists patients_active        on patients (tb_status) where archived = false;
create index if not exists patients_location      on patients (location_id) where archived = false;
create index if not exists patients_med_groups    on patients using gin (medical_risk_groups);
create index if not exists patients_soc_groups    on patients using gin (social_risk_groups);
create index if not exists patients_contact_of    on patients (contact_of) where contact_of is not null;

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

-- ── TRIGGER: updated_at ──────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists patients_updated_at on patients;
create trigger patients_updated_at before update on patients
  for each row execute function set_updated_at();
