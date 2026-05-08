-- All API access goes through Vercel functions using the service_role key,
-- which bypasses RLS by design. Enabling RLS on every table without policies
-- means the public anon key (which ships in the frontend bundle for potential
-- future Realtime use) cannot read or modify anything.

alter table patients       enable row level security;
alter table fluorography   enable row level security;
alter table sputum_tests   enable row level security;
alter table questionnaires enable row level security;
alter table mis_imports    enable row level security;
alter table audit_log      enable row level security;
alter table attachments    enable row level security;
alter table locations      enable row level security;

-- locations is a tiny public reference table (2 rows) — readable by anon
do $$ begin
  create policy locations_read_all on locations for select using (true);
exception when duplicate_object then null; end $$;
