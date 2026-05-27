#!/usr/bin/env node
// One-shot rollback for the previous import-adpm run that hit the wrong
// location. Removes adpm rows with source='imported_xlsx' and patients
// inserted within the last N minutes at the given location_id.
//
// Usage:
//   node scripts/rollback-import.mjs --location zaluzhe --minutes 30 [--apply]

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const loc = (() => {
  const i = args.indexOf('--location');
  return i >= 0 ? args[i + 1] : null;
})();
const minutes = (() => {
  const i = args.indexOf('--minutes');
  return i >= 0 ? parseInt(args[i + 1], 10) : 30;
})();
if (!loc) {
  console.error('Usage: --location <bilohirska|zaluzhe> [--minutes 30] [--apply]');
  process.exit(1);
}

const URL = 'https://fxxyziqzdumphwwsacqk.supabase.co/rest/v1';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const env = readFileSync('.env.local', 'utf8');
  const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
  if (m) process.env.SUPABASE_SERVICE_ROLE_KEY = m[1].trim();
}
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
console.log(`Cutoff: created_at >= ${cutoff}, location_id = ${loc}`);

// 1. Count adpm rows with source='imported_xlsx'
const adpmRes = await fetch(`${URL}/adpm_vaccinations?select=id&source=eq.imported_xlsx`, { headers });
const adpmRows = await adpmRes.json();
console.log(`adpm_vaccinations source=imported_xlsx: ${adpmRows.length}`);

// 2. Count patients inserted recently at given location
const patRes = await fetch(
  `${URL}/patients?select=id,medics_id,surname,first_name,location_id,created_at&location_id=eq.${loc}&created_at=gte.${cutoff}`,
  { headers },
);
const patRows = await patRes.json();
console.log(`patients location=${loc} created_at>=${cutoff}: ${patRows.length}`);

if (!APPLY) {
  console.log('\nDRY RUN. Pass --apply to delete.');
  process.exit(0);
}

// 3. Delete adpm rows first (they reference patients).
console.log(`\nDeleting ${adpmRows.length} adpm rows…`);
const delAdpm = await fetch(`${URL}/adpm_vaccinations?source=eq.imported_xlsx`, {
  method: 'DELETE',
  headers,
});
if (!delAdpm.ok) {
  console.error('delete adpm failed:', delAdpm.status, await delAdpm.text());
  process.exit(1);
}
console.log('  done');

// 4. Delete patients (cascade will remove anything else linked).
console.log(`\nDeleting ${patRows.length} patients…`);
const delPat = await fetch(
  `${URL}/patients?location_id=eq.${loc}&created_at=gte.${cutoff}`,
  { method: 'DELETE', headers },
);
if (!delPat.ok) {
  console.error('delete patients failed:', delPat.status, await delPat.text());
  process.exit(1);
}
console.log('  done');

console.log('\n✓ Rollback complete.');
