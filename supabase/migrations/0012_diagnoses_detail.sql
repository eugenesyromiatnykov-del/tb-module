-- Per-diagnosis detail: code + name + best-effort date (from MIS episode start
-- date when available, otherwise null). Enables tooltips on the registry that
-- explain which exact diagnosis triggered each risk-group tag.
--
-- We keep the existing `diagnoses_codes text[]` for backward compatibility
-- (parser fallback, existing analytics). `diagnoses_detail` is REPLACED on
-- each extension sync (MIS is authoritative for current state).

alter table patients
  add column if not exists diagnoses_detail jsonb not null default '[]'::jsonb;

-- Rebuild patient_dashboard to expose diagnoses_detail.
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.village, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups,
  p.diagnoses_codes, p.diagnoses_detail, p.diagnoses_synced_at,
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
