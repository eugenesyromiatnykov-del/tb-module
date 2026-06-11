-- Per-doctor permission to launch auto-sync. Default false so a freshly
-- onboarded doctor can use the app (view patients, manage records) but
-- cannot kick off the heavy Chrome-extension batch sync — that hammers
-- Vercel Fluid Active CPU and burns the monthly free-tier quota fast.
--
-- Grant manually per-doctor when the workload is justified.

alter table doctors
  add column if not exists can_run_sync boolean not null default false;

-- Grandfather the first doctor (created at multi-tenant bootstrap). This
-- is the only seat that historically ran sync, so silently flipping false
-- on them would break their workflow.
update doctors
   set can_run_sync = true
 where id = '00000000-0000-0000-0000-000000000001';

-- Stop any active job whose owner just lost permission. Without this the
-- runner keeps churning until next start/resume call; we want CPU to drop
-- immediately on deploy.
update sync_jobs
   set status = 'stopped',
       stopped_at = now()
  where status in ('queued', 'running')
    and doctor_id in (select id from doctors where can_run_sync = false);
