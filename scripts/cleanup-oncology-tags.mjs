#!/usr/bin/env node
// One-off cleanup for the over-broad oncology rule (см. коміт 10c114e).
// Знаходить пацієнтів з medical_risk_groups, що містить 'oncology', але без
// жодного діагнозу, який реально матчить вузький набір правил онкології.
// Знімає тег. Інші теги (hiv, diabetes тощо) не чіпає. tb_status НЕ змінюється
// автоматично — це робить extension-sync на наступному аналізі через МІС.
//
// Usage:
//   node scripts/cleanup-oncology-tags.mjs            # dry-run
//   node scripts/cleanup-oncology-tags.mjs --apply
//   node scripts/cleanup-oncology-tags.mjs --apply --verbose

import { readFileSync } from 'node:fs';

const URL = 'https://fxxyziqzdumphwwsacqk.supabase.co/rest/v1';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const env = readFileSync('.env.local', 'utf8');
    const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (m) process.env.SUPABASE_SERVICE_ROLE_KEY = m[1].trim();
  } catch { /* ignore */ }
}
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing (env or .env.local)');
  process.exit(1);
}
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// ── Точна копія правил онкології з tb-module-sync.js (на момент коміту 10c114e).
// Якщо правила в розширенні змінюватимуться — синхронізуй цей блок.
const ICPC_ONCOLOGY = new Set([
  'A79', 'B72', 'B74',
  'D74', 'D75', 'D76', 'D77',
  'L71', 'N74',
  'R84', 'R85',
  'T71',
  'U75', 'U76', 'U77',
  'W72',
  'X75', 'X76', 'X77',
  'Y77', 'Y78',
]);

const ICD10_ONCOLOGY_RULES = [
  /^C\d/,        // C00–C97 — все злоякісні
  /^D0\d/,       // D00–D09 — carcinoma in situ
  /^D4[567]\b/,  // D45–D47 — мієлопроліферативні + MDS + гематологічні невизначені
];

function isOncologyCode(code) {
  if (!code) return false;
  // ICPC-2 — без крапки, 3 символи.
  if (!code.includes('.') && /^[A-Z]\d{2}$/.test(code)) {
    return ICPC_ONCOLOGY.has(code);
  }
  // МКХ-10 — за префіксом.
  return ICD10_ONCOLOGY_RULES.some((re) => re.test(code));
}

async function fetchAll(table, query) {
  const all = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${URL}/${table}?${query}&offset=${offset}&limit=1000`, { headers });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function main() {
  console.log('Loading patients with oncology tag…');
  // PostgREST array-contains: cs.{value}
  const patients = await fetchAll(
    'patients',
    'select=id,surname,first_name,patronymic,medical_risk_groups,diagnoses_codes,diagnoses_synced_at&medical_risk_groups=cs.{oncology}',
  );
  console.log(`  ${patients.length} patients carry 'oncology'`);

  const toClean = [];
  const kept = [];
  for (const p of patients) {
    const codes = Array.isArray(p.diagnoses_codes) ? p.diagnoses_codes : [];
    const matching = codes.filter(isOncologyCode);
    if (matching.length === 0) {
      toClean.push(p);
    } else {
      kept.push({ p, matching });
    }
  }

  console.log(`\nKeep   (≥1 valid oncology code in diagnoses): ${kept.length}`);
  console.log(`Strip  (no valid code → false positive):       ${toClean.length}`);

  if (VERBOSE && kept.length > 0) {
    console.log('\nSample kept:');
    kept.slice(0, 10).forEach(({ p, matching }) => {
      console.log(`  ${p.surname} ${p.first_name} — ${matching.join(', ')}`);
    });
  }
  if (VERBOSE && toClean.length > 0) {
    console.log('\nSample to strip:');
    toClean.slice(0, 10).forEach((p) => {
      const codes = (p.diagnoses_codes ?? []).join(', ') || '(no diagnoses)';
      const synced = p.diagnoses_synced_at ? p.diagnoses_synced_at.slice(0, 10) : 'never synced';
      console.log(`  ${p.surname} ${p.first_name} — diagnoses=[${codes}] synced=${synced}`);
    });
  }

  // Important: patients with empty diagnoses_codes AND never synced shouldn't
  // be touched — we can't tell whether the oncology tag is legitimately
  // doctor-added or a leftover from a previous broken sync. Skip them.
  const neverSynced = toClean.filter((p) => !p.diagnoses_synced_at);
  const safeToClean = toClean.filter((p) => !!p.diagnoses_synced_at);

  if (neverSynced.length > 0) {
    console.log(
      `\n⚠ ${neverSynced.length} patients have 'oncology' but were never synced via extension —`,
    );
    console.log(`  could be doctor-set manually. Skipping these to be safe.`);
    if (VERBOSE) {
      neverSynced.slice(0, 10).forEach((p) =>
        console.log(`    ${p.surname} ${p.first_name}`),
      );
    }
  }

  console.log(`\nFinal: will strip 'oncology' from ${safeToClean.length} patients.`);

  if (!APPLY) {
    console.log('\n[DRY RUN] no changes written. Pass --apply to execute.');
    return;
  }

  console.log('\n=== APPLYING ===');
  let n = 0;
  for (const p of safeToClean) {
    const next = (p.medical_risk_groups ?? []).filter((g) => g !== 'oncology');
    const r = await fetch(`${URL}/patients?id=eq.${p.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ medical_risk_groups: next }),
    });
    if (!r.ok) {
      console.error(`\nfailed for ${p.id}: ${r.status} ${await r.text()}`);
      continue;
    }
    n++;
    if (n % 50 === 0) process.stdout.write(`\r  cleaned ${n}/${safeToClean.length}`);
  }
  if (n) process.stdout.write('\n');
  console.log(`\n✓ Done. Stripped 'oncology' from ${n} patients.`);
  console.log(
    `\nNote: tb_status was NOT touched. Patients who end up with empty groups`,
  );
  console.log(`will be demoted to 'cleared' automatically on their next МІС analysis.`);
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
