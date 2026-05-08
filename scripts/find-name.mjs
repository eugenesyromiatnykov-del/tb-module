#!/usr/bin/env node
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const query = (process.argv[3] ?? '').toLowerCase();
if (!file || !query) {
  console.error('Usage: node find-name.mjs <file.xlsx> "<query>"');
  process.exit(1);
}

const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true });

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const joined = row.map((c) => String(c ?? '')).join(' | ').toLowerCase();
    if (joined.includes(query)) {
      console.log(`[${sheetName} row ${r + 1}] ${row.slice(0, 18).map((c) => String(c ?? '').slice(0, 30)).join(' | ')}`);
    }
  }
}
