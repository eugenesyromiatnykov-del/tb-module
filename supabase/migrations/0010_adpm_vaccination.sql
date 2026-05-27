-- АДП-М (diphtheria-tetanus, reduced antigen) vaccination tracking.
-- All declarants need a dose every 10 years unless they have a
-- contraindication or have refused (refusal requires a signed photo proof).

-- ── 1. Records table ───────────────────────────────────────────────────────
create table if not exists adpm_vaccinations (
  id            uuid primary key default uuid_generate_v4(),
  patient_id    uuid not null references patients(id) on delete cascade,
  date          date not null,
  vaccine_name  text,                              -- e.g. "Вакцина для профілактики дифтерії та правця…(АДП-М)"
  manufacturer  text,
  lot_number    text,
  notes         text,
  source        data_source not null default 'manual',
  created_at    timestamptz not null default now()
);

create index if not exists adpm_patient on adpm_vaccinations (patient_id, date desc);
alter table adpm_vaccinations enable row level security;

-- ── 2. Patient-level АДП-М status ──────────────────────────────────────────
-- A patient is in exactly one of: vaccinated (has records), contraindicated,
-- refused, or "needs vaccination" (none of the above). Contraindication &
-- refusal flags are mutually exclusive; check enforces that.
alter table patients
  add column if not exists adpm_contraindication boolean not null default false,
  add column if not exists adpm_contraindication_reason text,
  add column if not exists adpm_refused boolean not null default false,
  add column if not exists adpm_refusal_date date,
  add column if not exists adpm_refusal_photo_path text;

do $$ begin
  alter table patients
    add constraint adpm_flags_exclusive
    check (not (adpm_contraindication and adpm_refused));
exception when duplicate_object then null; end $$;

-- ── 3. Per-patient summary view ────────────────────────────────────────────
-- Latest АДП-М per patient + auto-computed next due date (10 years later).
create or replace view patient_adpm_summary as
select distinct on (a.patient_id)
  a.patient_id,
  a.date                          as last_adpm_date,
  (a.date + interval '10 years')::date as next_adpm_date
from adpm_vaccinations a
order by a.patient_id, a.date desc nulls last;

-- ── 4. Rebuild patient_dashboard to include АДП-М columns ──────────────────
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups, p.diagnoses_codes, p.diagnoses_synced_at,
  p.notes, p.archived, p.archived_reason, p.archived_at, p.is_external,
  p.created_at, p.updated_at,
  -- Fluoro
  f.last_fluoro_date, f.next_planned_date, f.last_result_code,
  -- Sputum
  s.last_sputum_date, s.last_sputum_test_type, s.last_sputum_result,
  -- Quantiferon
  q.last_quantiferon_date, q.last_quantiferon_result_code, q.last_quantiferon_result,
  -- АДП-М
  a.last_adpm_date, a.next_adpm_date,
  p.adpm_contraindication, p.adpm_contraindication_reason,
  p.adpm_refused, p.adpm_refusal_date, p.adpm_refusal_photo_path
from patients p
left join patient_fluoro_summary       f on f.patient_id = p.id
left join patient_sputum_summary       s on s.patient_id = p.id
left join patient_quantiferon_summary  q on q.patient_id = p.id
left join patient_adpm_summary         a on a.patient_id = p.id;

-- ── 5. Storage bucket for refusal photos ───────────────────────────────────
-- Private bucket — read/write via service role only (signed URLs from server).
insert into storage.buckets (id, name, public)
values ('adpm-refusals', 'adpm-refusals', false)
on conflict (id) do nothing;
