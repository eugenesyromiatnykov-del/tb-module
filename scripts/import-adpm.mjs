#!/usr/bin/env node
// One-shot bulk import from "Планування щеплень декларантів.xlsx".
//
// Sheets consumed:
//   "Щеплення Білогіря"  → patients + adpm vaccination records, location=bilohirska
//   "Щеплення Залужжя"   → patients + adpm vaccination records, location=zaluzhe
//   "Актуальні Білогіря" → patients only, location=bilohirska
//   "Актуальні Залужжя"  → patients only, location=zaluzhe
//   "Протипокази"        → set adpm_contraindication=true + reason
//   "Відмови"            → set adpm_refused=true
//
// Matching: medics_id when present (primary), otherwise
// (surname, first_name, patronymic, birth_date) normalised case-insensitively.
//
// Usage:
//   node scripts/import-adpm.mjs <file.xlsx> --dry-run
//   node scripts/import-adpm.mjs <file.xlsx> --apply

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('Usage: node scripts/import-adpm.mjs <file.xlsx> [--apply]');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// ── Supabase REST setup ────────────────────────────────────────────────────
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

async function fetchAll(table, select) {
  const all = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${URL}/${table}?select=${select}&offset=${offset}&limit=1000`, { headers });
    if (!r.ok) throw new Error(`fetchAll ${table}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function batchInsert(table, rows, chunkSize = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const r = await fetch(`${URL}/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
    const ret = await r.json();
    out.push(...ret);
    process.stdout.write(`\r  inserted ${i + chunk.length}/${rows.length} into ${table}`);
  }
  if (rows.length) process.stdout.write('\n');
  return out;
}

async function patchOne(table, id, patch) {
  const r = await fetch(`${URL}/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`patch ${table}/${id}: ${r.status} ${await r.text()}`);
}

// ── Parsing helpers ────────────────────────────────────────────────────────

// Excel epoch is 1899-12-30 because of the 1900 leap year bug. Floor the
// fractional part — we only care about the date.
function excelSerialToIso(value) {
  if (value == null || value === '' || value === '-' || value === '#VALUE!') return null;
  const s = String(value).trim();
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) {
    return `${dot[3]}-${dot[2].padStart(2, '0')}-${dot[1].padStart(2, '0')}`;
  }
  // Already ISO?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const num = parseFloat(s);
  if (!isFinite(num) || num < 365 || num > 90000) return null;
  const ms = Math.floor(num) * 86400000;
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return d.toISOString().slice(0, 10);
}

function normPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/^=\s*\+?/, '');                    // "=+380…" formula form
  if (/^\d+\.\d+E\+\d+$/i.test(s)) {                 // scientific notation
    const n = Math.round(parseFloat(s));
    s = String(n);
  }
  s = s.replace(/[^\d+]/g, '');
  if (!s) return null;
  if (!s.startsWith('+')) {
    if (s.startsWith('380')) s = '+' + s;
    else if (s.startsWith('0')) s = '+38' + s;
  }
  return s.length >= 11 ? s : null;
}

function normGender(g) {
  const s = String(g ?? '').trim().toLowerCase();
  if (s.startsWith('ч')) return 'M';
  if (s.startsWith('ж')) return 'F';
  return null;
}

function normName(s) {
  return (s ?? '').toString().toLowerCase().replace(/[ʼ`'']/g, "'").replace(/\s+/g, ' ').trim();
}

function nameBirthKey(p) {
  return `${normName(p.surname)}|${normName(p.first_name)}|${normName(p.patronymic)}|${p.birth_date}`;
}

function titleCase(s) {
  if (!s) return s;
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function normVillage(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[ʼ`']/g, "'");
  if (!s) return null;
  return titleCase(s);
}

// ── Sheet readers ──────────────────────────────────────────────────────────

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some((c) => String(c ?? '').trim().toLowerCase().includes('прізвище'))) {
      return i;
    }
  }
  return -1;
}

function headerIndex(header, candidates) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (candidates.some((c) => h === c || h.startsWith(c))) return i;
  }
  return -1;
}

function readSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return { header: [], data: [] };
  return { header: rows[headerIdx], data: rows.slice(headerIdx + 1) };
}

function parsePatientRow(row, cols) {
  const surnameRaw = row[cols.surname];
  const firstRaw = row[cols.first];
  const birthRaw = row[cols.birth];
  if (!surnameRaw || !firstRaw || !birthRaw) return null;
  const birth = excelSerialToIso(birthRaw);
  if (!birth) return null;
  return {
    medics_id: row[cols.medics_id] != null ? String(row[cols.medics_id]).trim() || null : null,
    surname: String(surnameRaw).trim(),
    first_name: String(firstRaw).trim(),
    patronymic: row[cols.patronymic] ? String(row[cols.patronymic]).trim() : null,
    gender: normGender(row[cols.gender]),
    phone: cols.phone >= 0 ? normPhone(row[cols.phone]) : null,
    birth_date: birth,
    village: cols.village >= 0 ? normVillage(row[cols.village]) : null,
    last_adpm_date: cols.last_adpm >= 0 ? excelSerialToIso(row[cols.last_adpm]) : null,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading ${file}…`);
  const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: false });

  // ── Collect rows from each sheet ─────────────────────────────────────────
  // Only Білогіря — Залужжя sheets intentionally skipped on this run.
  const sources = [
    { sheet: 'Актуальні Білогіря', location: 'bilohirska', hasVacc: false },
    { sheet: 'Щеплення Білогіря',  location: 'bilohirska', hasVacc: true },
  ];

  const incoming = []; // { …patient, location, last_adpm_date? }
  for (const src of sources) {
    const ws = wb.Sheets[src.sheet];
    if (!ws) {
      console.warn(`  ⚠ sheet "${src.sheet}" not found, skip`);
      continue;
    }
    const { header, data } = readSheet(ws);
    const cols = {
      medics_id: headerIndex(header, ['medics id']),
      surname: headerIndex(header, ['прізвище']),
      first: headerIndex(header, ["ім'я", 'імʼя', 'имя']),
      patronymic: headerIndex(header, ['по-батькові', 'по батькові']),
      gender: headerIndex(header, ['стать']),
      phone: headerIndex(header, ['телефон']),
      birth: headerIndex(header, ['дата народження']),
      village: headerIndex(header, ['місто', 'село', 'населений']),
      last_adpm: src.hasVacc ? headerIndex(header, ['остання вакцина']) : -1,
    };
    if (cols.surname < 0 || cols.first < 0 || cols.birth < 0) {
      console.warn(`  ⚠ "${src.sheet}" header missing surname/first/birth — skip`);
      continue;
    }
    let parsed = 0;
    for (const row of data) {
      const p = parsePatientRow(row, cols);
      if (!p) continue;
      incoming.push({ ...p, location: src.location, sheet: src.sheet });
      parsed++;
    }
    console.log(`  ${src.sheet}: ${parsed} valid rows`);
  }

  // De-dup incoming rows: prefer the row with adpm date when same medics_id/name.
  const incomingByKey = new Map();
  for (const p of incoming) {
    const k = p.medics_id ? `m:${p.medics_id}` : `n:${nameBirthKey(p)}`;
    const prev = incomingByKey.get(k);
    if (!prev) {
      incomingByKey.set(k, p);
    } else {
      // Merge: prefer non-null fields, latest adpm date.
      const merged = { ...prev };
      for (const f of ['medics_id', 'gender', 'phone', 'village', 'patronymic']) {
        if (!merged[f] && p[f]) merged[f] = p[f];
      }
      if (p.last_adpm_date && (!merged.last_adpm_date || p.last_adpm_date > merged.last_adpm_date)) {
        merged.last_adpm_date = p.last_adpm_date;
      }
      // Location: prefer the sheet that has vaccination data.
      if (p.last_adpm_date && !prev.last_adpm_date) merged.location = p.location;
      incomingByKey.set(k, merged);
    }
  }
  const incomingDedup = [...incomingByKey.values()];
  console.log(`\nTotal unique incoming patients: ${incomingDedup.length}`);

  // ── Load existing patients ──────────────────────────────────────────────
  console.log('\nLoading existing patients…');
  const existing = await fetchAll(
    'patients',
    'id,medics_id,surname,first_name,patronymic,birth_date,gender,phone,village,location_id,adpm_contraindication,adpm_refused',
  );
  console.log(`  ${existing.length} existing rows`);
  const byMedicsId = new Map(existing.filter((p) => p.medics_id).map((p) => [p.medics_id, p]));
  const byNameBirth = new Map(existing.map((p) => [nameBirthKey(p), p]));

  // ── Classify incoming: insert vs update ─────────────────────────────────
  const toInsert = []; // patient rows
  const toPatch = [];  // { id, patch }
  const adpmInserts = []; // resolved later (patient_id, date)
  const adpmPending = []; // { incoming, key } — patient_id resolved post-insert

  for (const p of incomingDedup) {
    let match = p.medics_id ? byMedicsId.get(p.medics_id) : null;
    if (!match) match = byNameBirth.get(nameBirthKey(p));

    if (match) {
      const patch = {};
      // Fill missing fields, don't overwrite.
      for (const f of ['medics_id', 'gender', 'phone', 'village', 'location_id']) {
        const src = f === 'location_id' ? p.location : p[f];
        if (src && !match[f]) patch[f] = src;
      }
      if (Object.keys(patch).length > 0) toPatch.push({ id: match.id, patch });
      if (p.last_adpm_date) adpmInserts.push({ patient_id: match.id, date: p.last_adpm_date });
    } else {
      toInsert.push({
        medics_id: p.medics_id,
        surname: p.surname,
        first_name: p.first_name,
        patronymic: p.patronymic,
        gender: p.gender,
        phone: p.phone,
        birth_date: p.birth_date,
        village: p.village,
        location_id: p.location,
        tb_status: 'risk',
        medical_risk_groups: [],
        social_risk_groups: [],
        diagnoses_codes: [],
      });
      if (p.last_adpm_date) {
        adpmPending.push({ key: nameBirthKey(p), medics_id: p.medics_id, date: p.last_adpm_date });
      }
    }
  }

  console.log(`\nPatient diff:`);
  console.log(`  insert: ${toInsert.length}`);
  console.log(`  update: ${toPatch.length}`);
  console.log(`  АДП-М records to add (matched existing): ${adpmInserts.length}`);
  console.log(`  АДП-М records to add (new patients): ${adpmPending.length}`);

  // ── Protipokazы / Vidmovy sheets ────────────────────────────────────────
  const contraSheet = wb.Sheets['Протипокази'];
  const contras = []; // { surname, first, patronymic, birth, reason }
  if (contraSheet) {
    const { header, data } = readSheet(contraSheet);
    const cols = {
      surname: headerIndex(header, ['прізвище']),
      first: headerIndex(header, ["ім'я", 'імʼя']),
      patronymic: headerIndex(header, ['по-батькові', 'по батькові']),
      birth: headerIndex(header, ['дата народження']),
      reason: headerIndex(header, ['причина']),
      vaccine: headerIndex(header, ['вакцина']),
    };
    for (const row of data) {
      const vaccine = String(row[cols.vaccine] ?? '').toLowerCase();
      if (vaccine && !vaccine.includes('адп')) continue;
      const birth = excelSerialToIso(row[cols.birth]);
      if (!row[cols.surname] || !row[cols.first] || !birth) continue;
      contras.push({
        surname: String(row[cols.surname]).trim(),
        first_name: String(row[cols.first]).trim(),
        patronymic: row[cols.patronymic] ? String(row[cols.patronymic]).trim() : null,
        birth_date: birth,
        reason: row[cols.reason] ? String(row[cols.reason]).trim() : null,
      });
    }
  }
  const refSheet = wb.Sheets['Відмови'];
  const refs = [];
  if (refSheet) {
    const { header, data } = readSheet(refSheet);
    const cols = {
      surname: headerIndex(header, ['прізвище']),
      first: headerIndex(header, ["ім'я", 'імʼя']),
      patronymic: headerIndex(header, ['по-батькові', 'по батькові']),
      birth: headerIndex(header, ['дата народження']),
      vaccine: headerIndex(header, ['вакцина']),
    };
    for (const row of data) {
      const vaccine = String(row[cols.vaccine] ?? '').toLowerCase();
      if (vaccine && !vaccine.includes('адп')) continue;
      const birth = excelSerialToIso(row[cols.birth]);
      if (!row[cols.surname] || !row[cols.first] || !birth) continue;
      refs.push({
        surname: String(row[cols.surname]).trim(),
        first_name: String(row[cols.first]).trim(),
        patronymic: row[cols.patronymic] ? String(row[cols.patronymic]).trim() : null,
        birth_date: birth,
      });
    }
  }
  console.log(`\nПротипокази rows: ${contras.length} (АДП-М only)`);
  console.log(`Відмови rows:    ${refs.length} (АДП-М only)`);

  if (!APPLY) {
    console.log('\n[DRY RUN] no changes written. Pass --apply to execute.');
    return;
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  console.log('\n=== APPLYING ===');

  // 1. Insert new patients (batched).
  let inserted = [];
  if (toInsert.length > 0) {
    console.log(`Inserting ${toInsert.length} new patients…`);
    inserted = await batchInsert('patients', toInsert);
    // Refresh lookup maps with inserted rows.
    for (const p of inserted) {
      if (p.medics_id) byMedicsId.set(p.medics_id, p);
      byNameBirth.set(nameBirthKey(p), p);
    }
  }

  // 2. Patch existing (small set, do sequentially).
  if (toPatch.length > 0) {
    console.log(`Patching ${toPatch.length} existing patients…`);
    let i = 0;
    for (const { id, patch } of toPatch) {
      await patchOne('patients', id, patch);
      i++;
      if (i % 50 === 0) process.stdout.write(`\r  patched ${i}/${toPatch.length}`);
    }
    if (i) process.stdout.write('\n');
  }

  // 3. Resolve pending АДП-М (for newly-inserted patients).
  for (const a of adpmPending) {
    const match = a.medics_id ? byMedicsId.get(a.medics_id) : byNameBirth.get(a.key);
    if (match) adpmInserts.push({ patient_id: match.id, date: a.date });
  }

  // De-dup adpm rows by (patient_id, date), then check against existing.
  const adpmSeen = new Set();
  const adpmDedup = adpmInserts.filter((a) => {
    const k = `${a.patient_id}|${a.date}`;
    if (adpmSeen.has(k)) return false;
    adpmSeen.add(k);
    return true;
  });
  const existingAdpm = await fetchAll('adpm_vaccinations', 'patient_id,date');
  const existingAdpmKeys = new Set(existingAdpm.map((a) => `${a.patient_id}|${a.date}`));
  const adpmFinal = adpmDedup.filter((a) => !existingAdpmKeys.has(`${a.patient_id}|${a.date}`));
  if (adpmFinal.length > 0) {
    console.log(`Inserting ${adpmFinal.length} АДП-М vaccination records…`);
    await batchInsert(
      'adpm_vaccinations',
      adpmFinal.map((a) => ({
        patient_id: a.patient_id,
        date: a.date,
        source: 'imported_xlsx',
      })),
    );
  }

  // 4. Protipokazы.
  if (contras.length > 0) {
    console.log(`Applying ${contras.length} contraindication flags…`);
    let n = 0, miss = 0;
    for (const c of contras) {
      const m = byNameBirth.get(nameBirthKey(c));
      if (!m) { miss++; continue; }
      await patchOne('patients', m.id, {
        adpm_contraindication: true,
        adpm_contraindication_reason: c.reason,
        adpm_refused: false,
        adpm_refusal_date: null,
      });
      n++;
    }
    console.log(`  applied ${n}, unmatched ${miss}`);
  }

  // 5. Vidmovy.
  if (refs.length > 0) {
    console.log(`Applying ${refs.length} refusal flags…`);
    let n = 0, miss = 0;
    for (const r of refs) {
      const m = byNameBirth.get(nameBirthKey(r));
      if (!m) { miss++; continue; }
      await patchOne('patients', m.id, {
        adpm_refused: true,
        adpm_contraindication: false,
        adpm_contraindication_reason: null,
      });
      n++;
    }
    console.log(`  applied ${n}, unmatched ${miss}`);
  }

  console.log('\n✓ Done.');
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
