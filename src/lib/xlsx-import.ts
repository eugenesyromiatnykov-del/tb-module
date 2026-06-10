import * as XLSX from 'xlsx';
import { parseDateLoose } from './date-utils';
import type { IncomingPatient, LocationId } from '@/types/database';

export type ParseResult = {
  rows: IncomingPatient[];
  totalInFile: number;
  warnings: string[];
  /** Per-location row counts after auto-detection, for the preview. */
  byLocation: Record<LocationId, number>;
};

const SHEET_CANDIDATES = ['Активні', 'активні', 'Active'];

// Multi-ambulatory doctors (Doctor 1) get string-based detection across
// their two practices. Single-ambulatory doctors always fall back —
// their xlsx may say "Білогірська" but it's THEIR Білогірська (a
// separate location row tagged to their doctor_id), not Doctor 1's.
// Without this guard, detectLocation would mis-route to Doctor 1's
// location_id and the row would still belong to the right doctor by
// doctor_id but reference a foreign location_id.
function detectLocation(department: string | null, fallback: LocationId): LocationId {
  if (!department) return fallback;
  if (fallback !== 'bilohirska' && fallback !== 'zaluzhe') return fallback;
  const s = department.toLowerCase();
  if (s.includes('білогір') || s.includes('biloh')) return 'bilohirska';
  if (s.includes('залуж') || s.includes('zaluzh')) return 'zaluzhe';
  return fallback;
}

export async function parseDeclarantsXlsx(
  file: File,
  fallbackLocation: LocationId,
): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const empty = { bilohirska: 0, zaluzhe: 0 } as Record<LocationId, number>;
  const sheetName =
    wb.SheetNames.find((n) => SHEET_CANDIDATES.includes(n)) ?? wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], totalInFile: 0, warnings: ['Файл не містить листів'], byLocation: { ...empty } };
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) return { rows: [], totalInFile: 0, warnings: [`Лист "${sheetName}" не знайдено`], byLocation: { ...empty } };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
  if (aoa.length < 2) return { rows: [], totalInFile: 0, warnings: ['У листі немає даних'], byLocation: { ...empty } };

  const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iMedics = idx('Medics ID');
  const iSurname = idx('Прізвище');
  const iFirst = idx("Ім'я", 'Імʼя', 'Імя');
  const iPatronymic = idx('По батькові');
  const iGender = idx('Стать');
  const iBirth = idx('Дата народження');
  const iPhone = idx('Телефон');
  const iAddress = idx('Адреса');
  const iCity = idx('Місто');
  const iDept = idx('Відділення');

  const warnings: string[] = [];
  // Required minimum — Стать / phone / address / city are accepted but optional,
  // so an "export from МІС" with just identity columns still works for the
  // regular declarant refresh.
  const required = [
    ['Medics ID', iMedics],
    ['Прізвище', iSurname],
    ["Ім'я", iFirst],
    ['Дата народження', iBirth],
  ] as const;
  for (const [name, i] of required) {
    if (i < 0) warnings.push(`Не знайдено обовʼязкову колонку "${name}"`);
  }
  if (warnings.length > 0) return { rows: [], totalInFile: 0, warnings, byLocation: { ...empty } };

  const rows: IncomingPatient[] = [];
  const byLocation: Record<LocationId, number> = { ...empty };
  let totalInFile = 0;
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const medics = clean(row[iMedics]);
    const surname = clean(row[iSurname]);
    const first = clean(row[iFirst]);
    if (!medics && !surname && !first) continue; // empty row
    totalInFile += 1;

    if (!medics) {
      warnings.push(`Рядок ${r + 1}: відсутній Medics ID — пропущено`);
      continue;
    }
    if (!surname || !first) {
      warnings.push(`Рядок ${r + 1} (${medics}): відсутні ПІБ — пропущено`);
      continue;
    }
    const birth = iBirth >= 0 ? parseDateLoose(row[iBirth]) : null;
    if (!birth) {
      warnings.push(`Рядок ${r + 1} (${medics}): не вдалось розпізнати дату народження — пропущено`);
      continue;
    }

    const address = joinAddress(clean(row[iAddress]), clean(row[iCity]));
    const dept = iDept >= 0 ? clean(row[iDept]) : null;
    const location_id = detectLocation(dept, fallbackLocation);
    byLocation[location_id] += 1;

    rows.push({
      medics_id: medics,
      surname,
      first_name: first,
      patronymic: iPatronymic >= 0 ? clean(row[iPatronymic]) : null,
      birth_date: birth,
      gender: iGender >= 0 ? mapGender(clean(row[iGender])) : null,
      phone: iPhone >= 0 ? normalizePhone(clean(row[iPhone])) : null,
      address,
      location_id,
    });
  }

  // Dedupe by medics_id (keep first occurrence; warn on duplicates).
  const seen = new Set<string>();
  const deduped: IncomingPatient[] = [];
  for (const r of rows) {
    if (seen.has(r.medics_id)) {
      warnings.push(`Дубль Medics ID ${r.medics_id} — другий рядок проігноровано`);
      continue;
    }
    seen.add(r.medics_id);
    deduped.push(r);
  }

  return { rows: deduped, totalInFile, warnings, byLocation };
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function mapGender(v: string | null): 'M' | 'F' | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.startsWith('ч')) return 'M';
  if (s.startsWith('ж')) return 'F';
  if (s === 'm' || s === 'м') return 'M';
  if (s === 'f' || s === 'ф') return 'F';
  return null;
}

function normalizePhone(v: string | null): string | null {
  if (!v) return null;
  // If MIS exported phones as scientific notation ("3.80988E+11"), we lose
  // the last digits — recover what we can but mark as suspect.
  if (/^[\d.]+e\+?\d+$/i.test(v.replace(/\s/g, ''))) {
    const n = Number(v);
    if (isFinite(n)) return `+${Math.round(n)}`;
    return v;
  }
  // Otherwise keep digits + leading + only.
  const digits = v.replace(/[^\d+]/g, '');
  return digits.length > 0 ? digits : null;
}

function joinAddress(addr: string | null, city: string | null): string | null {
  const parts = [addr, city].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.map((p) => p.trim()).filter(Boolean).join(', ');
}
