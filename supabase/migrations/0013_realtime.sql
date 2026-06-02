-- Realtime support: enable the supabase_realtime publication on tables the
-- frontend wants to watch, and add read-only RLS policies for the
-- `authenticated` JWT role so the WebSocket channel can deliver row payloads.
--
-- All write endpoints still go through Vercel functions with the service_role
-- key, which bypasses RLS — frontend never writes to the DB directly.
-- These policies grant SELECT only.
--
-- The signed JWT the frontend uses for Realtime is minted server-side from
-- the existing PIN session (see api/auth/me.ts ?supabase=1) and signed with
-- SUPABASE_JWT_SECRET, so its `role: authenticated` claim is trusted.

-- Late-arriving tables need RLS toggled on first.
do $$ begin
  alter table quantiferon_tests enable row level security;
exception when undefined_table then null; end $$;
do $$ begin
  alter table adpm_vaccinations enable row level security;
exception when undefined_table then null; end $$;

-- Read policies for the authenticated role.
do $$ begin
  create policy "auth select patients"          on patients          for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth select fluorography"      on fluorography      for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth select sputum_tests"      on sputum_tests      for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth select quantiferon_tests" on quantiferon_tests for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth select adpm_vaccinations" on adpm_vaccinations for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Add to supabase_realtime publication so postgres_changes events flow.
do $$ begin
  alter publication supabase_realtime add table patients;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table fluorography;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table sputum_tests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table quantiferon_tests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table adpm_vaccinations;
exception when duplicate_object then null; end $$;
