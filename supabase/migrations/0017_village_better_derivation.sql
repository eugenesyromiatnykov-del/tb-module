-- Improve patients.village derivation.
--
-- Two real-world cases were lossy under 0011_village.sql:
--
--   1. Recent xlsx imports stored address as the village name only — no
--      `с.` / `смт.` / `м.` prefix, often ALL-CAPS Cyrillic (e.g.
--      "ЗАЛУЖЖЯ"). The old regex required one of those prefixes and never
--      matched, so village stayed NULL → patient invisible to the
--      village MultiSelect filter on /patients and /vaccinations. ~35%
--      of the registry (655 of 1874) fell into this bucket.
--
--   2. The trigger fired ON INSERT only. When the extension or xlsx
--      apply UPDATEd an address-without-village (because the previous
--      INSERT also failed to derive it), village never got a second
--      chance.
--
-- Fixes:
--   • title_case_uk() helper to consolidate "ЗАЛУЖЖЯ" + "Залужжя" into
--     one bucket. The dropdown was showing two separate items, filter
--     matched only one.
--   • Derive function gains a no-comma fallback: when the address has
--     no comma at all, take it whole as the village name.
--   • Trigger fires on INSERT and UPDATE of address/village.
--   • Two backfills: one to derive newly-catchable villages, one to
--     re-title-case any pre-existing village values.

create or replace function title_case_uk(s text) returns text as $$
  select case
    when s is null or trim(s) = '' then null
    else upper(left(trim(s), 1)) || lower(substring(trim(s) from 2))
  end;
$$ language sql immutable;

create or replace function patients_derive_village_on_insert() returns trigger as $$
begin
  if new.village is null and new.address is not null then
    new.village := title_case_uk(
      coalesce(
        (regexp_match(new.address, '(?:^|,)\s*с\.\s*([^,]+)', 'i'))[1],
        (regexp_match(new.address, '(?:^|,)\s*смт\.?\s*([^,]+)', 'i'))[1],
        (regexp_match(new.address, '(?:^|,)\s*м\.\s*([^,]+)', 'i'))[1],
        case when new.address !~ ',' then trim(both ' .' from new.address) else null end
      )
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists patients_derive_village on patients;
create trigger patients_derive_village
  before insert or update of address, village on patients
  for each row execute function patients_derive_village_on_insert();

-- Backfill 1: derive village for rows where address is set but village is null.
update patients
set village = title_case_uk(
  coalesce(
    (regexp_match(address, '(?:^|,)\s*с\.\s*([^,]+)', 'i'))[1],
    (regexp_match(address, '(?:^|,)\s*смт\.?\s*([^,]+)', 'i'))[1],
    (regexp_match(address, '(?:^|,)\s*м\.\s*([^,]+)', 'i'))[1],
    case when address !~ ',' then trim(both ' .' from address) else null end
  )
)
where village is null and address is not null and trim(address) <> '';

-- Backfill 2: normalise case across pre-existing villages so the
-- post-backfill dropdown lists each village exactly once.
update patients
set village = title_case_uk(village)
where village is not null
  and village <> title_case_uk(village);
