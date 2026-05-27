-- Patient settlement (село / селище / місто) as a separate field, derived
-- from the free-form `address` when possible. We keep `address` for the
-- street + house number; `village` is for filtering and grouping.
--
-- Auto-derive triggers only on INSERT to avoid clobbering a doctor's manual
-- override on subsequent updates. To re-derive, the doctor can clear the
-- village field — the API PATCH still accepts whatever value is sent (incl.
-- null), and the next insert/sync from the extension will re-derive.

alter table patients
  add column if not exists village text;

create index if not exists patients_village on patients (village);

-- One-off backfill from address.
update patients
set village = trim(both ' .' from coalesce(
  (regexp_match(address, '(?:^|,)\s*с\.\s*([^,]+)', 'i'))[1],
  (regexp_match(address, '(?:^|,)\s*смт\.?\s*([^,]+)', 'i'))[1],
  (regexp_match(address, '(?:^|,)\s*м\.\s*([^,]+)', 'i'))[1]
))
where village is null and address is not null;

create or replace function patients_derive_village_on_insert() returns trigger as $$
begin
  if new.village is null and new.address is not null then
    new.village := trim(both ' .' from coalesce(
      (regexp_match(new.address, '(?:^|,)\s*с\.\s*([^,]+)', 'i'))[1],
      (regexp_match(new.address, '(?:^|,)\s*смт\.?\s*([^,]+)', 'i'))[1],
      (regexp_match(new.address, '(?:^|,)\s*м\.\s*([^,]+)', 'i'))[1]
    ));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists patients_derive_village on patients;
create trigger patients_derive_village
  before insert on patients
  for each row execute function patients_derive_village_on_insert();

-- Rebuild patient_dashboard to expose village.
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.village, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups, p.diagnoses_codes, p.diagnoses_synced_at,
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
