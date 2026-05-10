#!/usr/bin/env node
// Merge patient duplicates by (surname+first+birth_date+patronymic).
// Safe rules:
//   - skip groups with 2+ medics_id (different real people)
//   - keeper = the row with medics_id; if none, first row
//   - merge social_risk_groups + medical_risk_groups (set union)
//   - tb_status priority: detected > contact > external > risk > cleared
//   - re-link fluorography.patient_id and sputum_tests.patient_id to keeper
//   - delete non-keeper patient rows
//   - after re-link, delete duplicate fluoro/sputum rows by (patient_id, date, result_code/test_type)
//
// Usage:
//   node scripts/merge-dupes.mjs --dry-run   # show plan
//   node scripts/merge-dupes.mjs --apply     # execute

import { readFileSync } from 'node:fs';

const URL = 'https://fxxyziqzdumphwwsacqk.supabase.co/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  // fallback to .env.local
  const env = readFileSync('.env.local', 'utf8');
  const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
  if (m) process.env.SUPABASE_SERVICE_ROLE_KEY = m[1].trim();
}
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// If keeper has a medics_id (real declarant), they CAN be promoted to detected/contact,
// but never demoted to external — external is "not a declarant".
const PRIORITY_DECLARANT = { detected: 5, contact: 4, risk: 2, cleared: 1, archived: 0, external: 0 };
const PRIORITY_NON_DECLARANT = { detected: 5, contact: 4, external: 3, risk: 2, cleared: 1, archived: 0 };

async function fetchAll(table, select) {
  const all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${URL}/${table}?select=${select}&offset=${offset}&limit=1000`, { headers });
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

function normName(s) {
  return (s ?? '').toString().toLowerCase().replace(/[ʼ'`]/g, "'").trim();
}
function key(p) {
  return `${normName(p.surname)}|${normName(p.first_name)}|${normName(p.patronymic)}|${p.birth_date}`;
}
function pickStatus(group, keeper) {
  const priority = keeper.medics_id ? PRIORITY_DECLARANT : PRIORITY_NON_DECLARANT;
  return group.reduce(
    (best, p) => (priority[p.tb_status] > priority[best] ? p.tb_status : best),
    keeper.tb_status,
  );
}

(async () => {
  console.log(`Mode: ${DRY ? 'DRY RUN' : 'APPLY'}`);

  const patients = await fetchAll('patients', 'id,medics_id,surname,first_name,patronymic,birth_date,gender,phone,address,location_id,tb_status,social_risk_groups,medical_risk_groups,notes,created_at');
  console.log(`Loaded ${patients.length} patients`);

  const groups = new Map();
  for (const p of patients) {
    const k = key(p);
    (groups.get(k) || groups.set(k, []).get(k)).push(p);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`Duplicate groups: ${dupGroups.length}`);

  let merges = 0;
  let skippedSamePib = 0;
  const ops = []; // {keeper, losers, finalStatus, finalSocial, finalMedical, finalPhone, finalAddress, finalNotes, finalLocation, finalGender, finalPatronymic}

  for (const group of dupGroups) {
    const withMedics = group.filter((p) => p.medics_id);
    if (withMedics.length >= 2) {
      skippedSamePib += 1;
      console.log(`  SKIP (multiple medics_id, likely different people): ${group[0].surname} ${group[0].first_name} ${group[0].patronymic ?? ''} (${group[0].birth_date})`);
      continue;
    }
    const keeper = withMedics[0] ?? group[0];
    const losers = group.filter((p) => p.id !== keeper.id);

    const allSocial = new Set();
    const allMedical = new Set();
    for (const p of group) {
      for (const g of p.social_risk_groups || []) allSocial.add(g);
      for (const g of p.medical_risk_groups || []) allMedical.add(g);
    }
    const finalStatus = pickStatus(group, keeper);
    // Pick the longest/most-informative non-null fields, preferring keeper's value.
    const pickField = (field) => {
      const candidates = [keeper, ...losers].map((p) => p[field]).filter((v) => v != null && v !== '');
      return candidates[0] ?? null;
    };

    ops.push({
      keeper,
      losers,
      finalStatus,
      finalSocial: [...allSocial],
      finalMedical: [...allMedical],
      finalPhone: pickField('phone'),
      finalAddress: pickField('address'),
      finalNotes: pickField('notes'),
      finalLocation: keeper.location_id ?? pickField('location_id'),
      finalGender: keeper.gender ?? pickField('gender'),
      finalPatronymic: keeper.patronymic ?? pickField('patronymic'),
    });
    merges += 1;
  }

  console.log(`\nWill merge: ${merges} groups, removing ${ops.reduce((a, o) => a + o.losers.length, 0)} loser rows`);
  console.log(`Will skip:  ${skippedSamePib} groups (multiple medics_id)`);

  if (DRY) {
    console.log('\n--- Sample of merge ops ---');
    for (const op of ops.slice(0, 10)) {
      console.log(`  keep ${op.keeper.surname} ${op.keeper.first_name} (${op.keeper.birth_date}) [${op.keeper.medics_id ?? 'no-medics'}/${op.keeper.tb_status}/${op.keeper.location_id}]`);
      console.log(`     → final tb_status=${op.finalStatus}, social=${JSON.stringify(op.finalSocial)}`);
      for (const l of op.losers) {
        console.log(`     drop [${l.medics_id ?? 'no-medics'}/${l.tb_status}/${l.location_id}] groups=${JSON.stringify(l.social_risk_groups)}`);
      }
    }
    if (ops.length > 10) console.log(`  ... +${ops.length - 10} more`);
    console.log('\nDRY RUN finished. Re-run with --apply to execute.');
    return;
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  let movedFluoro = 0, movedSputum = 0, deletedPatients = 0, deletedDupeFluoro = 0, deletedDupeSputum = 0;

  for (const [i, op] of ops.entries()) {
    if (i % 5 === 0) process.stdout.write(`\r  ${i}/${ops.length}…`);

    // 1) Update keeper with merged fields.
    const patch = {
      tb_status: op.finalStatus,
      social_risk_groups: op.finalSocial,
      medical_risk_groups: op.finalMedical,
      phone: op.finalPhone,
      address: op.finalAddress,
      notes: op.finalNotes,
      location_id: op.finalLocation,
      gender: op.finalGender,
      patronymic: op.finalPatronymic,
    };
    let r = await fetch(`${URL}/patients?id=eq.${op.keeper.id}`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error(`update keeper ${op.keeper.id}: ${r.status} ${await r.text()}`);

    // 2) Move fluoro + sputum from losers to keeper.
    for (const l of op.losers) {
      r = await fetch(`${URL}/fluorography?patient_id=eq.${l.id}`, { method: 'PATCH', headers, body: JSON.stringify({ patient_id: op.keeper.id }) });
      if (!r.ok) throw new Error(`move fluoro ${l.id}: ${r.status} ${await r.text()}`);
      // Preserve count
      r = await fetch(`${URL}/sputum_tests?patient_id=eq.${l.id}`, { method: 'PATCH', headers, body: JSON.stringify({ patient_id: op.keeper.id }) });
      if (!r.ok) throw new Error(`move sputum ${l.id}: ${r.status} ${await r.text()}`);
    }

    // 3) Delete loser patients.
    for (const l of op.losers) {
      r = await fetch(`${URL}/patients?id=eq.${l.id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error(`delete patient ${l.id}: ${r.status} ${await r.text()}`);
      deletedPatients += 1;
    }
  }
  console.log(`\n  Done merging patients. Deleted: ${deletedPatients}`);

  // 4) Dedupe fluoro / sputum globally.
  console.log('\nDeduping fluoro/sputum…');
  const fluoros = await fetchAll('fluorography', 'id,patient_id,date,result_code,created_at');
  const fluoroByKey = new Map();
  for (const f of fluoros) {
    const k = `${f.patient_id}|${f.date}|${f.result_code}`;
    (fluoroByKey.get(k) || fluoroByKey.set(k, []).get(k)).push(f);
  }
  for (const arr of fluoroByKey.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const losers = arr.slice(1);
    for (const f of losers) {
      const r = await fetch(`${URL}/fluorography?id=eq.${f.id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error(`delete fluoro ${f.id}`);
      deletedDupeFluoro += 1;
    }
  }

  const sputums = await fetchAll('sputum_tests', 'id,patient_id,date,test_type,created_at');
  const sputumByKey = new Map();
  for (const s of sputums) {
    const k = `${s.patient_id}|${s.date}|${s.test_type}`;
    (sputumByKey.get(k) || sputumByKey.set(k, []).get(k)).push(s);
  }
  for (const arr of sputumByKey.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const losers = arr.slice(1);
    for (const s of losers) {
      const r = await fetch(`${URL}/sputum_tests?id=eq.${s.id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error(`delete sputum ${s.id}`);
      deletedDupeSputum += 1;
    }
  }

  console.log(`\nResult: merged ${merges} groups, deleted ${deletedPatients} patient rows, ${deletedDupeFluoro} fluoro dupes, ${deletedDupeSputum} sputum dupes`);
  console.log(`Skipped (multiple medics_id): ${skippedSamePib}`);
})();
