-- The /api/patients?mode=villages endpoint used to do a plain
-- `select village from patients where archived=false and village is not null`
-- and de-duplicate client-side. Supabase's PostgREST silently caps every
-- request at 1000 rows regardless of the .range() the client asks for, so
-- with 1874 active patients sorted alphabetically by village, the first
-- 1000 rows covered villages А–З; everything К and after (Корниця,
-- Мокроволя, Окіп, …) was truncated → dropdown missed them entirely,
-- doctor's filter found "Нічого не знайдено" for very real villages.
--
-- Fix: do the DISTINCT in Postgres so the response is one row per village
-- (<100 rows total) — well inside any row cap.

create or replace function get_villages() returns table(village text) as $$
  select distinct trim(p.village) as village
  from patients p
  where p.village is not null
    and p.archived = false
    and trim(p.village) <> ''
  order by trim(p.village);
$$ language sql stable;

-- Grant to the service role only (anon never calls this; web app + extension
-- both go through the Vercel function which uses service_role).
grant execute on function get_villages() to service_role;
