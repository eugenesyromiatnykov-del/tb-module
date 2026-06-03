-- Pin a running sync_job to a specific device.
--
-- The extension on every device with the same PIN polls /api/patients?mode=
-- sync_job and starts driving as soon as it sees status='running'. Without an
-- owner field this means two laptops both pick up the same job and race —
-- doctor leaves laptop A grinding overnight, walks to laptop B in the
-- morning, opens the web app, and suddenly laptop B is opening medics.ua
-- tabs too.
--
-- Fix: the first device whose extension polls the job claims it (CAS
-- update on owner_device_id IS NULL). Every subsequent heartbeat from
-- that device passes the same id, so the same row keeps updating.
-- Other devices see owner_device_id != theirs → idle. The device-id is
-- a UUID the extension generates once and persists in chrome.storage.local.

alter table sync_jobs
  add column if not exists owner_device_id text,
  -- Optional label the device sends ("Eugene MacBook", auto-derived from
  -- navigator.userAgent fallback). Purely cosmetic for /sync UI; the
  -- locking key is owner_device_id.
  add column if not exists owner_device_label text;

-- No backfill — running jobs at migration time will simply get claimed
-- by whichever device polls next. Worst-case the doctor has to /sync →
-- Скасувати + restart to nudge it.
