#!/usr/bin/env node
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/inspect-xlsx.mjs <file.xlsx>');
  process.exit(1);
}

const buf = readFileSync(file);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

console.log(`\n## ${file}`);
console.log(`sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(' | ')}\n`);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  console.log(`\n=== sheet: "${sheetName}" — ${rows.length} rows ===`);
  if (rows.length === 0) continue;

  // Show first 5 rows (headers + samples)
  const preview = rows.slice(0, 5);
  for (let i = 0; i < preview.length; i++) {
    const row = preview[i];
    const cells = (row || []).map((c) =>
      c === null || c === undefined ? '' : String(c).slice(0, 40),
    );
    console.log(`  row${i}: [${cells.length}] ${JSON.stringify(cells)}`);
  }
  if (rows.length > 5) console.log(`  … +${rows.length - 5} more rows`);
}
