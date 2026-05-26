-- Refactor: simplified registry model.
-- - is_external becomes a boolean tag instead of a tb_status value
-- - 'contact' becomes the close_contact social_risk_group + tb_status='risk'
-- - 'cleared' and 'observed-without-fluoro' rows are deleted
-- - 'observed' is repurposed: "has fluoro history, no risk groups assigned —
--   needs manual review" (kept so the doctor can triage later)

-- 1) New is_external column.
alter table patients add column if not exists is_external boolean not null default false;

-- 2) Tag previous 'external' patients, then move them to 'risk' (or keep
--    detected/etc. as-is; trigger normalises observed/risk based on groups).
update patients
   set is_external = true
 where tb_status = 'external';

update patients
   set tb_status = 'risk'
 where tb_status = 'external';

-- 3) Translate 'contact' status into a close_contact social risk group.
update patients
   set social_risk_groups = array_append(coalesce(social_risk_groups, '{}'::text[]), 'close_contact')
 where tb_status = 'contact'
   and not ('close_contact' = any(coalesce(social_risk_groups, '{}'::text[])));

update patients
   set tb_status = 'risk'
 where tb_status = 'contact';

-- 4) Delete 'cleared' rows (registry contains only currently-tracked patients).
delete from patients where tb_status = 'cleared';

-- 5) Delete 'observed' patients with no fluoro records and no risk groups.
--    Anyone we still need to see will resurface via the Chrome extension on
--    their next medics.ua visit if they're actually at risk.
delete from patients
 where tb_status = 'observed'
   and cardinality(coalesce(medical_risk_groups, '{}'::text[])) = 0
   and cardinality(coalesce(social_risk_groups, '{}'::text[])) = 0
   and not exists (select 1 from fluorography f where f.patient_id = patients.id);

-- Remaining 'observed' rows now mean "has fluoro history but no risk groups
-- yet" — the UI surfaces these as "Потребує перегляду" so the doctor can
-- assign a group manually.

-- 6) Rebuild patient_dashboard view to expose is_external.
-- Must DROP + CREATE (not CREATE OR REPLACE) because we insert is_external
-- in the middle of the column list; PG only allows REPLACE to add at the end.
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id,
  p.medics_id,
  p.surname,
  p.first_name,
  p.patronymic,
  p.birth_date,
  p.gender,
  p.phone,
  p.address,
  p.location_id,
  p.tb_status,
  p.contact_of,
  p.medical_risk_groups,
  p.social_risk_groups,
  p.diagnoses_codes,
  p.diagnoses_synced_at,
  p.notes,
  p.archived,
  p.archived_reason,
  p.archived_at,
  p.is_external,
  p.created_at,
  p.updated_at,
  s.last_fluoro_date,
  s.next_planned_date,
  s.last_result_code
from patients p
left join patient_fluoro_summary s on s.patient_id = p.id;
