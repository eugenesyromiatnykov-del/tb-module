-- Quantiferon (IGRA) test results — entered manually by the doctor.
-- Result codes: positive / negative / indeterminate / unknown.

do $$ begin
  create type quantiferon_result_code as enum ('positive', 'negative', 'indeterminate', 'unknown');
exception when duplicate_object then null; end $$;

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
alter table quantiferon_tests enable row level security;

-- Latest quantiferon per patient (same pattern as patient_fluoro_summary).
create or replace view patient_quantiferon_summary as
select distinct on (q.patient_id)
  q.patient_id,
  q.date          as last_quantiferon_date,
  q.result_code   as last_quantiferon_result_code,
  q.result        as last_quantiferon_result
from quantiferon_tests q
order by q.patient_id, q.date desc nulls last;

-- Latest sputum per patient too (didn't have one yet; need it for summary card).
create or replace view patient_sputum_summary as
select distinct on (s.patient_id)
  s.patient_id,
  s.date           as last_sputum_date,
  s.test_type      as last_sputum_test_type,
  s.result         as last_sputum_result
from sputum_tests s
order by s.patient_id, s.date desc nulls last;

-- Rebuild patient_dashboard to expose last sputum + quantiferon.
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups, p.diagnoses_codes, p.diagnoses_synced_at,
  p.notes, p.archived, p.archived_reason, p.archived_at, p.is_external,
  p.created_at, p.updated_at,
  f.last_fluoro_date, f.next_planned_date, f.last_result_code,
  s.last_sputum_date, s.last_sputum_test_type, s.last_sputum_result,
  q.last_quantiferon_date, q.last_quantiferon_result_code, q.last_quantiferon_result
from patients p
left join patient_fluoro_summary       f on f.patient_id = p.id
left join patient_sputum_summary       s on s.patient_id = p.id
left join patient_quantiferon_summary  q on q.patient_id = p.id;
