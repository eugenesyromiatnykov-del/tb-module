-- Latest fluoro per patient: pick the one with the most recent `date`.
create or replace view patient_fluoro_summary as
select distinct on (f.patient_id)
  f.patient_id,
  f.date            as last_fluoro_date,
  f.next_planned_date,
  f.result_code     as last_result_code
from fluorography f
order by f.patient_id, f.date desc nulls last;

-- Joined view used by the dashboard and the registry.
-- last_fluoro_date / next_planned_date are NULL when the patient has no
-- fluoro records yet.
create or replace view patient_dashboard as
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
  p.created_at,
  p.updated_at,
  s.last_fluoro_date,
  s.next_planned_date,
  s.last_result_code
from patients p
left join patient_fluoro_summary s on s.patient_id = p.id;

-- Make views readable via service_role (RLS on base tables is bypassed by
-- service_role; views inherit base-table policies for non-service callers).
grant select on patient_fluoro_summary to authenticated;
grant select on patient_dashboard      to authenticated;
