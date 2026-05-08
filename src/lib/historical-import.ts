import * as XLSX from 'xlsx';
import { parseDateLoose } from './date-utils';
import type { FluoroResultCode, PatientForDiff } from '@/types/database';

// ── Sheet name → social risk group key mapping ─────────────────────────────
const RISK_SHEET_MAP: Record<string, string> = {
  'близький контакт': 'close_contact',
  'віл': 'hiv',
  'онкологія': 'oncology',
  'раніше лікувались': 'previously_treated',
  'цукровий діабет': 'diabetes',
  'пневмонія': 'pneumonia_history',
  'хронічні респіраторні': 'chronic_respiratory',
  'виразкова хвороба': 'peptic_ulcer',
  'медичні працівники': 'medical_worker',
  'психіатрія': 'psychiatric',
  'позбавлені волі': 'prisoners',
  'переселенці': 'displaced',
  'малозабезпечені': 'low_income',
  'притулки': 'shelters',
};

function mapResultCode(raw: string | null): { code: FluoroResultCode; text: string | null } {
  if (!raw) return { code: 'unknown', text: null };
  const s = raw.toLowerCase();
  if (s.includes('без патології') || s.includes('норма')) return { code: 'normal', text: raw };
  if (s.includes('патолог') || s.includes('зтб') || s.includes('хр.бр') || s.includes('зззтб'))
    return { code: 'pathology', text: raw };
  if (s.includes('очікує') || s.includes('pending') || s.includes('пенд'))
    return { code: 'pending', text: raw };
  if (s.includes('відмов') || s.includes('не пройш')) return { code: 'refused', text: raw };
  if (s.trim() === '-' || s.trim() === '') return { code: 'unknown', text: null };
  return { code: 'unknown', text: raw };
}

// ── Patient match index ────────────────────────────────────────────────────
export type MatchIndex = {
  byKey: Map<string, PatientForDiff[]>;
};

function normName(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[ʼ'`]/g, "'").trim();
}

function buildKey(surname: string | null, firstName: string | null, birthIso: string | null): string {
  return `${normName(surname)}|${normName(firstName)}|${birthIso ?? ''}`;
}

export function buildMatchIndex(patients: PatientForDiff[]): MatchIndex {
  const byKey = new Map<string, PatientForDiff[]>();
  for (const p of patients) {
    const k = buildKey(p.surname, p.first_name, p.birth_date);
    const cur = byKey.get(k);
    if (cur) cur.push(p);
    else byKey.set(k, [p]);
  }
  return { byKey };
}

function splitFullName(fullName: string): { surname: string; first: string; patronymic: string | null } | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return {
    surname: parts[0],
    first: parts[1],
    patronymic: parts.slice(2).join(' ') || null,
  };
}

function matchPatient(
  index: MatchIndex,
  surname: string,
  first: string,
  birthIso: string | null,
): { id: string } | { multiple: number } | null {
  const key = buildKey(surname, first, birthIso);
  const candidates = index.byKey.get(key);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length > 1) return { multiple: candidates.length };
  return { id: candidates[0].id };
}

// ── 1) Fluorography xlsx ────────────────────────────────────────────────────
// Sheets: "Флюорографія Білогіря", "Флюорографія Залужжя" (with full data),
// and "Актуальні Білогіря" / "Актуальні Залужжя" (no fluoro data — skipped).

export type FluoroBulkRow = {
  medics_id: string;
  date: string;
  result: string | null;
  result_code: FluoroResultCode;
  next_planned_date: string | null;
};

export type FluoroParseResult = {
  rows: FluoroBulkRow[];
  totalInFile: number;
  skipped: number;
  warnings: string[];
};

export async function parseFluoroHistoryXlsx(file: File): Promise<FluoroParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const rows: FluoroBulkRow[] = [];
  const warnings: string[] = [];
  let totalInFile = 0;
  let skipped = 0;

  for (const sheetName of wb.SheetNames) {
    const lower = sheetName.toLowerCase();
    if (!lower.includes('флюорограф')) continue;

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
    if (aoa.length < 2) continue;

    // Headers may be on row 0 or row 1 (some sheets have a blank row 0).
    let headerRow = -1;
    for (let i = 0; i < Math.min(3, aoa.length); i++) {
      const row = aoa[i] ?? [];
      if (row.some((c) => String(c ?? '').includes('Medics'))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) continue;
    const headers = (aoa[headerRow] ?? []).map((h) => String(h ?? '').trim());
    const idx = (...names: string[]) => {
      for (const n of names) {
        const i = headers.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };

    const iMedics = idx('Medics ID');
    const iDate = idx('Дата проведення', 'Дата');
    const iNext = idx('Наступна флюоро', 'Заплановано');
    const iResult = idx('Результат');
    if (iMedics < 0 || iDate < 0) continue;

    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const medics = clean(row[iMedics]);
      if (!medics) continue;
      totalInFile += 1;

      const date = parseDateLoose(row[iDate]);
      if (!date) {
        skipped += 1;
        continue;
      }

      const resultRaw = iResult >= 0 ? clean(row[iResult]) : null;
      const { code, text } = mapResultCode(resultRaw);
      const next = iNext >= 0 ? parseDateLoose(row[iNext]) : null;

      rows.push({
        medics_id: medics,
        date,
        result: text,
        result_code: code,
        next_planned_date: next,
      });
    }
  }

  if (rows.length === 0) warnings.push('Жодного валідного запису не знайдено');
  return { rows, totalInFile, skipped, warnings };
}

// ── 2) Risk Groups xlsx (14 sheets, one per social group) ──────────────────

export type RiskUpdate = {
  id: string;
  add_social: string[];
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null; next_planned_date: string | null }[];
};

export type RiskExternalCandidate = {
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  add_social: string[];
  add_fluoro: { date: string; result_code: FluoroResultCode; result: string | null; next_planned_date: string | null }[];
};

export type RiskParseResult = {
  updates: RiskUpdate[];
  externalCandidates: RiskExternalCandidate[];
  /** Rows where ПІБ/ДН couldn't even be parsed (corrupt input). */
  invalid: { fullName: string; birth: string; group: string }[];
  warnings: string[];
  totalRows: number;
};

export async function parseRiskGroupsXlsx(file: File, index: MatchIndex): Promise<RiskParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const byPatient = new Map<string, RiskUpdate>();
  const externalByKey = new Map<string, RiskExternalCandidate>();
  const invalid: RiskParseResult['invalid'] = [];
  const warnings: string[] = [];
  let totalRows = 0;

  for (const sheetName of wb.SheetNames) {
    const groupKey = RISK_SHEET_MAP[sheetName.toLowerCase().trim()];
    if (!groupKey) {
      warnings.push(`Лист "${sheetName}" — невідома група, пропускаємо`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
    if (aoa.length < 3) continue;

    for (let r = 2; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const fullName = clean(row[0]);
      if (!fullName) continue;
      totalRows += 1;
      const split = splitFullName(fullName);
      if (!split) {
        invalid.push({ fullName, birth: String(row[1] ?? ''), group: groupKey });
        continue;
      }

      const birthIso = parseDateLoose(row[1]);
      const dateIso = parseDateLoose(row[2]);
      const resultRaw = clean(row[3]);
      const nextIso = parseDateLoose(row[4]);
      const { code, text } = mapResultCode(resultRaw);
      const fluoroRecord = dateIso
        ? { date: dateIso, result_code: code, result: text, next_planned_date: nextIso }
        : null;

      const m = matchPatient(index, split.surname, split.first, birthIso);
      if (m && !('multiple' in m)) {
        let entry = byPatient.get(m.id);
        if (!entry) {
          entry = { id: m.id, add_social: [], add_fluoro: [] };
          byPatient.set(m.id, entry);
        }
        if (!entry.add_social.includes(groupKey)) entry.add_social.push(groupKey);
        if (fluoroRecord) entry.add_fluoro!.push(fluoroRecord);
        continue;
      }

      // Unmatched → external candidate (de-duplicated by ПІБ+ДН).
      if (!birthIso) {
        invalid.push({ fullName, birth: String(row[1] ?? ''), group: groupKey });
        continue;
      }
      const key = `${normName(split.surname)}|${normName(split.first)}|${normName(split.patronymic)}|${birthIso}`;
      let ext = externalByKey.get(key);
      if (!ext) {
        ext = {
          surname: split.surname,
          first_name: split.first,
          patronymic: split.patronymic,
          birth_date: birthIso,
          add_social: [],
          add_fluoro: [],
        };
        externalByKey.set(key, ext);
      }
      if (!ext.add_social.includes(groupKey)) ext.add_social.push(groupKey);
      if (fluoroRecord) ext.add_fluoro.push(fluoroRecord);
    }
  }

  return {
    updates: Array.from(byPatient.values()),
    externalCandidates: Array.from(externalByKey.values()),
    invalid,
    warnings,
    totalRows,
  };
}

// ── 3) Detected/Contacts xlsx ──────────────────────────────────────────────

export type StatusUpdate = {
  id: string;
  tb_status: 'detected' | 'contact';
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null }[];
  add_sputum?: { date: string; test_type: 'xpert'; result: string | null }[];
};

export type StatusExternalCandidate = {
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  tb_status: 'detected' | 'contact';
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null }[];
  add_sputum?: { date: string; test_type: 'xpert'; result: string | null }[];
};

export type StatusParseResult = {
  updates: StatusUpdate[];
  externalCandidates: StatusExternalCandidate[];
  invalid: { fullName: string; birth: string; sheet: string }[];
  warnings: string[];
  totalRows: number;
};

export async function parseDetectedContactsXlsx(
  file: File,
  index: MatchIndex,
): Promise<StatusParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const updates: StatusUpdate[] = [];
  // 'detected' wins over 'contact' if same person appears in both sheets.
  const externalByKey = new Map<string, StatusExternalCandidate>();
  const invalid: StatusParseResult['invalid'] = [];
  const warnings: string[] = [];
  let totalRows = 0;

  for (const sheetName of wb.SheetNames) {
    const lower = sheetName.toLowerCase().trim();
    let status: StatusUpdate['tb_status'];
    if (lower.includes('виявл')) status = 'detected';
    else if (lower.includes('контакт')) status = 'contact';
    else continue;

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
    if (aoa.length < 3) continue;

    for (let r = 2; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const fullName = clean(row[0]);
      if (!fullName) continue;
      totalRows += 1;
      const split = splitFullName(fullName);
      if (!split) {
        invalid.push({ fullName, birth: String(row[1] ?? ''), sheet: sheetName });
        continue;
      }

      const birthIso = parseDateLoose(row[1]);
      const fluoroDate = parseDateLoose(row[2]);
      const fluoroResultRaw = clean(row[3]);
      const sputumDate = parseDateLoose(row[4]);
      const sputumResultRaw = clean(row[5]);

      const fluoros = fluoroDate
        ? [{ date: fluoroDate, result_code: mapResultCode(fluoroResultRaw).code, result: mapResultCode(fluoroResultRaw).text }]
        : undefined;
      const sputums = sputumDate
        ? [{ date: sputumDate, test_type: 'xpert' as const, result: sputumResultRaw }]
        : undefined;

      const m = matchPatient(index, split.surname, split.first, birthIso);
      if (m && !('multiple' in m)) {
        const u: StatusUpdate = { id: m.id, tb_status: status };
        if (fluoros) u.add_fluoro = fluoros;
        if (sputums) u.add_sputum = sputums;
        updates.push(u);
        continue;
      }

      if (!birthIso) {
        invalid.push({ fullName, birth: String(row[1] ?? ''), sheet: sheetName });
        continue;
      }
      const key = `${normName(split.surname)}|${normName(split.first)}|${normName(split.patronymic)}|${birthIso}`;
      const existing = externalByKey.get(key);
      // 'detected' overrides 'contact'.
      const newStatus: 'detected' | 'contact' =
        existing?.tb_status === 'detected' || status === 'detected' ? 'detected' : 'contact';
      const merged: StatusExternalCandidate = {
        surname: split.surname,
        first_name: split.first,
        patronymic: split.patronymic,
        birth_date: birthIso,
        tb_status: newStatus,
        add_fluoro: [...(existing?.add_fluoro ?? []), ...(fluoros ?? [])],
        add_sputum: [...(existing?.add_sputum ?? []), ...(sputums ?? [])],
      };
      if (merged.add_fluoro!.length === 0) delete merged.add_fluoro;
      if (merged.add_sputum!.length === 0) delete merged.add_sputum;
      externalByKey.set(key, merged);
    }
  }

  return {
    updates,
    externalCandidates: Array.from(externalByKey.values()),
    invalid,
    warnings,
    totalRows,
  };
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
