-- Per user: 'observed' is gone. Status is set manually by the doctor.
-- Final set in use: risk (default), detected, archived.
-- 'contact', 'cleared', 'external', 'observed' enum values remain in PG
-- (PG can't remove enum values cleanly) but are never assigned by the app.

-- 1) Drop the auto-status trigger — the doctor sets the status manually now.
drop trigger if exists patients_tb_status on patients;
drop function if exists maintain_tb_status();

-- 2) Remove every 'observed' patient. They came from declarants without
--    risk groups; if any of them actually matter for TB tracking, the
--    Chrome extension will recreate them on the next medics.ua visit
--    once a risk group is detected.
delete from patients where tb_status = 'observed';

-- 3) Default for new patients = 'risk' (was already, but make it explicit).
alter table patients alter column tb_status set default 'risk';
