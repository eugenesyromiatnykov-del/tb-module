-- Add 'observed' as a new tb_status value (default for declarants without
-- any risk groups). 'risk' is now reserved for patients who actually have
-- at least one medical_risk_groups or social_risk_groups entry.

alter type tb_status add value if not exists 'observed' before 'risk';

-- Trigger: automatically maintain risk ↔ observed transitions based on
-- the presence of risk groups. Other statuses (detected/contact/cleared/
-- external/archived) are NOT touched — those are explicit clinical states.

create or replace function maintain_tb_status() returns trigger as $$
begin
  if new.tb_status in ('observed', 'risk') then
    if cardinality(coalesce(new.medical_risk_groups, '{}'::text[])) > 0
       or cardinality(coalesce(new.social_risk_groups, '{}'::text[])) > 0 then
      new.tb_status := 'risk';
    else
      new.tb_status := 'observed';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists patients_tb_status on patients;
create trigger patients_tb_status before insert or update on patients
  for each row execute function maintain_tb_status();

-- Backfill existing rows: anyone marked 'risk' without any group → 'observed'.
update patients
   set tb_status = 'observed'
 where tb_status = 'risk'
   and cardinality(coalesce(medical_risk_groups, '{}'::text[])) = 0
   and cardinality(coalesce(social_risk_groups, '{}'::text[])) = 0;
