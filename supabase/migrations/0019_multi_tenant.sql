-- Multi-tenant: support multiple doctors with isolated patient registries
-- in the same Supabase project. Each doctor has their own PIN; their data
-- is fully isolated (own patients, own sync_jobs, own fluoro, etc.).
--
-- Migration is two-step intentionally:
--   (1) Run THIS file → creates doctors table + adds doctor_id columns
--       nullable + DOES NOT touch existing rows.
--   (2) Manually insert YOUR existing doctor with your current PIN_HASH:
--         INSERT INTO doctors (id, name, pin_hash) VALUES
--           ('00000000-0000-0000-0000-000000000001', 'Doctor 1', '<paste PIN_HASH>');
--   (3) Run the second part below (the DO block + ALTER … SET NOT NULL).
--       It refuses to proceed unless EXACTLY one doctor exists, then
--       backfills every tenant-scoped row to that doctor and locks the
--       NOT NULL constraint.
--
-- Splitting like this prevents a 'half-migrated' state where doctor_id
-- exists as a column but some rows have NULL forever — once NOT NULL is
-- on, inserts that forget doctor_id fail loudly instead of leaking data.

-- ─── PART 1: schema only ─────────────────────────────────────────────────────

create table if not exists doctors (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  pin_hash    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists doctors_updated_at on doctors;
create trigger doctors_updated_at before update on doctors
  for each row execute function set_updated_at();

-- Tenant-scoped tables get doctor_id. Nullable for now; backfill below.
-- `on delete restrict` because losing a doctor mid-life would orphan
-- their entire registry — explicit delete via "cascade everything"
-- script if ever needed.
alter table patients          add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table fluorography      add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table sputum_tests      add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table quantiferon_tests add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table adpm_vaccinations add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table questionnaires    add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table mis_imports       add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table audit_log         add column if not exists doctor_id uuid references doctors(id) on delete set null;
alter table attachments       add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table sync_jobs         add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table indicator_results add column if not exists doctor_id uuid references doctors(id) on delete restrict;
alter table locations         add column if not exists doctor_id uuid references doctors(id) on delete restrict;

-- Indexes for the hot filter path: every query in the API does
-- .eq('doctor_id', current_doctor) so this is the most-used predicate.
create index if not exists patients_doctor          on patients          (doctor_id) where archived = false;
create index if not exists fluorography_doctor      on fluorography      (doctor_id);
create index if not exists sputum_tests_doctor      on sputum_tests      (doctor_id);
create index if not exists quantiferon_tests_doctor on quantiferon_tests (doctor_id);
create index if not exists adpm_vaccinations_doctor on adpm_vaccinations (doctor_id);
create index if not exists sync_jobs_doctor         on sync_jobs         (doctor_id) where status in ('queued','running','paused','stopped');
create index if not exists indicator_results_doctor on indicator_results (doctor_id);
create index if not exists locations_doctor         on locations         (doctor_id);

-- Rebuild patient_dashboard view to expose doctor_id (needed by API
-- since the view is what we select from).
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
  p.doctor_id,
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

-- get_villages becomes tenant-aware. Without this, Doctor 2's dropdown
-- would show Doctor 1's villages.
drop function if exists get_villages();
create or replace function get_villages(p_doctor_id uuid) returns table(village text) as $$
  select distinct trim(p.village) as village
  from patients p
  where p.village is not null
    and p.archived = false
    and trim(p.village) <> ''
    and p.doctor_id = p_doctor_id
  order by trim(p.village);
$$ language sql stable;
grant execute on function get_villages(uuid) to service_role;

-- ─── PART 2: run AFTER inserting Doctor 1 ────────────────────────────────────
-- ⚠️  STOP. Before continuing, run:
--
--     INSERT INTO doctors (id, name, pin_hash) VALUES
--       ('00000000-0000-0000-0000-000000000001', 'Doctor 1', '<paste current PIN_HASH from Vercel env>');
--
-- THEN run the rest of this file. The DO block guards against running it
-- without a seeded doctor.

do $$
declare
  d_id uuid;
  d_count int;
begin
  select count(*) into d_count from doctors;
  if d_count = 0 then
    raise exception 'No doctors yet. Insert Doctor 1 first: INSERT INTO doctors (id, name, pin_hash) VALUES (''00000000-0000-0000-0000-000000000001'', ''Doctor 1'', ''<paste PIN_HASH>'');';
  end if;
  if d_count > 1 then
    raise exception 'More than one doctor (%) — cannot auto-backfill. Reset table or update manually.', d_count;
  end if;
  select id into d_id from doctors limit 1;
  update patients          set doctor_id = d_id where doctor_id is null;
  update fluorography      set doctor_id = d_id where doctor_id is null;
  update sputum_tests      set doctor_id = d_id where doctor_id is null;
  update quantiferon_tests set doctor_id = d_id where doctor_id is null;
  update adpm_vaccinations set doctor_id = d_id where doctor_id is null;
  update questionnaires    set doctor_id = d_id where doctor_id is null;
  update mis_imports       set doctor_id = d_id where doctor_id is null;
  update audit_log         set doctor_id = d_id where doctor_id is null;
  update attachments       set doctor_id = d_id where doctor_id is null;
  update sync_jobs         set doctor_id = d_id where doctor_id is null;
  update indicator_results set doctor_id = d_id where doctor_id is null;
  update locations         set doctor_id = d_id where doctor_id is null;
end $$;

alter table patients          alter column doctor_id set not null;
alter table fluorography      alter column doctor_id set not null;
alter table sputum_tests      alter column doctor_id set not null;
alter table quantiferon_tests alter column doctor_id set not null;
alter table adpm_vaccinations alter column doctor_id set not null;
alter table questionnaires    alter column doctor_id set not null;
alter table mis_imports       alter column doctor_id set not null;
alter table attachments       alter column doctor_id set not null;
alter table sync_jobs         alter column doctor_id set not null;
alter table indicator_results alter column doctor_id set not null;
alter table locations         alter column doctor_id set not null;
-- audit_log keeps doctor_id nullable (on delete set null) so deleted
-- doctors don't break the trail.
