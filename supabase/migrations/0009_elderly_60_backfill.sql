-- One-off backfill: tag patients 60+ with the social risk group elderly_60.
-- New patients arriving via the Chrome extension also get it automatically
-- (client-side, see extension-main/tb-module-sync.js).
-- No trigger here — once tagged, the doctor can still uncheck it manually.

update patients
   set social_risk_groups = array_append(coalesce(social_risk_groups, '{}'::text[]), 'elderly_60')
 where birth_date is not null
   and extract(year from age(birth_date)) >= 60
   and not ('elderly_60' = any(coalesce(social_risk_groups, '{}'::text[])));
