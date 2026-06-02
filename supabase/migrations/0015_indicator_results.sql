-- Indicator analysis results: per-patient, per-rule snapshot of the most
-- recent МІС-extension analysis. Normalised (one row per (patient, rule))
-- so we can filter/report by rule + state ("show me everyone whose
-- CVD-risk is overdue at location X") and so subsequent visits to the
-- same med-card can render last-known state instantly without re-running
-- the full DOM-parse analyzer.
--
-- Authoritative source: the МІС extension's indicator-matcher.js. Each
-- run replaces the patient's full set (extension is authoritative — if a
-- rule no longer applies to this patient, its row gets deleted). The
-- patients.last_indicators_synced_at column gives a cheap "is this
-- patient fresh?" lookup without joining.

create table if not exists indicator_results (
  id                uuid primary key default uuid_generate_v4(),
  patient_id        uuid not null references patients(id) on delete cascade,

  -- Stable identifier from extension-main/indicators-rules.js
  -- (e.g. 'cvd-risk-combined', 'breast-cancer-screening-result').
  rule_id           text not null,
  -- Cached human name for read-side convenience (rules rename in MIS over
  -- time; we want the label as it was when analysed).
  rule_name         text,
  rule_category     text,

  -- 'ОБСТЕЖЕННЯ' | 'НАПРАВЛЕННЯ' | 'ДІАГНОСТИЧНИЙ_ЗВІТ' | 'КОМПЛЕКСНА' |
  -- 'ПРОФІЛАКТИЧНИЙ_ОГЛЯД'. Needed downstream to render TODO sections
  -- with the same grouping logic as the МІС widget (referrals vs. labs).
  rule_type         text,
  -- "Чому ця норма застосовна до пацієнта": human-readable string from
  -- indicator-matcher.getDetailedApplicabilityReason — shown as info-icon
  -- tooltip in the МІС widget; mirror it in the registry UI.
  applicability_reason text,

  -- Status from indicator-matcher.js:
  --   'completed'  — все виконано в межах частоти
  --   'overdue'    — виконано, але прострочено
  --   'partial'    — частково виконано, не прострочено
  --   'not_done'   — нічого з потрібного
  state             text not null check (state in ('completed','overdue','partial','not_done')),
  is_overdue        boolean not null default false,

  completed_count   int not null default 0,
  total_count       int not null default 0,

  last_date         date,
  next_date         date,
  -- Frequency in months (e.g. 12, 24) — kept for repotting alongside the
  -- raw date so the read side doesn't have to re-derive periodicity.
  frequency_months  int,

  -- Raw arrays mirroring matcher output. Kept as JSONB so we don't have
  -- to model the inner shape (codes, labels, isExpired flags, etc.) at
  -- the SQL level — UI just renders.
  required_actions  jsonb not null default '[]'::jsonb,
  details           jsonb not null default '[]'::jsonb,

  analyzed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  unique (patient_id, rule_id)
);

create index if not exists indicator_results_patient_idx
  on indicator_results (patient_id);
create index if not exists indicator_results_rule_state_idx
  on indicator_results (rule_id, state);
create index if not exists indicator_results_analyzed_at_idx
  on indicator_results (analyzed_at desc);

alter table patients
  add column if not exists last_indicators_synced_at timestamptz,
  -- Patient-wide raw analyzer payload: observations (lab values + vitals),
  -- referrals, diagnostic reports, episodes, encounter actions. These are
  -- the source data the indicator matcher consumed; saving the snapshot
  -- means the registry UI can show "what МІС had on file at analysis
  -- time" alongside the computed indicator state (and tooltips can list
  -- the actual lab values, not just "is completed").
  add column if not exists last_analysis_snapshot jsonb;

-- Expose the new column through patient_dashboard so /api/extension-sync
-- and the web UI can read it the same way they read other dashboard
-- fields. The view explicitly lists columns so a bare ALTER TABLE on
-- patients doesn't propagate.
drop view if exists patient_dashboard;
create view patient_dashboard as
select
  p.id, p.medics_id, p.surname, p.first_name, p.patronymic, p.birth_date, p.gender,
  p.phone, p.address, p.village, p.location_id, p.tb_status, p.contact_of,
  p.medical_risk_groups, p.social_risk_groups,
  p.diagnoses_codes, p.diagnoses_detail, p.diagnoses_synced_at,
  p.last_indicators_synced_at,
  p.last_analysis_snapshot,
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
grant select on patient_dashboard to authenticated;

-- RLS: read-only for authenticated JWT (web app); writes go through
-- service_role from /api/extension-sync.
alter table indicator_results enable row level security;
do $$ begin
  create policy "auth select indicator_results"
    on indicator_results for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Add to realtime so /patient/[id] live-updates when extension finishes
-- analyzing on a separate medics.ua tab.
do $$ begin
  alter publication supabase_realtime add table indicator_results;
exception when duplicate_object then null; end $$;
