import { getSupabaseAdmin } from './_lib/supabase-server.js';
import { requireAuth } from './_lib/auth-guard.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = {
  status: (code: number) => Res;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

type FluoroResultCode = 'normal' | 'pathology' | 'pending' | 'refused' | 'unknown';

type FluoroBulkBody = {
  action: 'fluorography-bulk';
  rows: { medics_id: string; date: string; result?: string | null; result_code?: FluoroResultCode; next_planned_date?: string | null; notes?: string | null }[];
};

type RiskUpdate = {
  id: string;
  add_social: string[];
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null; next_planned_date: string | null }[];
};

type RiskExternal = {
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  location_id: string;
  add_social: string[];
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null; next_planned_date: string | null }[];
};

type RiskBulkBody = {
  action: 'risk-groups-bulk';
  updates: RiskUpdate[];
  create_external?: RiskExternal[];
};

type StatusUpdate = {
  id: string;
  tb_status: 'detected' | 'contact';
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null }[];
  add_sputum?: { date: string; test_type: string; result: string | null }[];
};

type StatusExternal = {
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  location_id: string;
  tb_status: 'detected' | 'contact';
  add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null }[];
  add_sputum?: { date: string; test_type: string; result: string | null }[];
};

type StatusBulkBody = {
  action: 'status-bulk';
  updates: StatusUpdate[];
  create_external?: StatusExternal[];
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as { action?: string };
  switch (body.action) {
    case 'fluorography-bulk':
      return handleFluoroBulk(body as FluoroBulkBody, res);
    case 'risk-groups-bulk':
      return handleRiskBulk(body as RiskBulkBody, res);
    case 'status-bulk':
      return handleStatusBulk(body as StatusBulkBody, res);
    default:
      res.status(400).json({ error: `Unknown action: ${body.action ?? '(missing)'}` });
  }
}

// ── Fluorography bulk import (match by medics_id) ──────────────────────────

async function handleFluoroBulk(body: FluoroBulkBody, res: Res) {
  if (!Array.isArray(body.rows)) {
    res.status(400).json({ error: 'rows[] required' });
    return;
  }
  const supabase = getSupabaseAdmin();

  const uniqueMedics = Array.from(new Set(body.rows.map((r) => r.medics_id)));
  const medicsToPatient = new Map<string, string>();
  for (const chunk of chunked(uniqueMedics, 1000)) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, medics_id')
      .in('medics_id', chunk);
    if (error) {
      res.status(500).json({ error: `lookup: ${error.message}` });
      return;
    }
    for (const p of data ?? []) {
      if (p.medics_id) medicsToPatient.set(p.medics_id, p.id as string);
    }
  }

  const inserts: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of body.rows) {
    const patientId = medicsToPatient.get(r.medics_id);
    if (!patientId) {
      skipped += 1;
      continue;
    }
    inserts.push({
      patient_id: patientId,
      date: r.date,
      result: r.result ?? null,
      result_code: r.result_code ?? 'unknown',
      next_planned_date: r.next_planned_date ?? null,
      notes: r.notes ?? null,
      source: 'imported_xlsx',
    });
  }

  const dedupedInserts = await dedupeFluoro(supabase, inserts as FluoroInsert[]);
  const skippedDupe = inserts.length - dedupedInserts.length;
  let added = 0;
  for (const chunk of chunked(dedupedInserts, 500)) {
    const { error, count } = await supabase
      .from('fluorography')
      .insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `insert: ${error.message}` });
      return;
    }
    added += count ?? chunk.length;
  }

  res.status(200).json({ added, skipped, skippedDupe, matched: inserts.length });
}

// ── Risk groups bulk (merge social_risk_groups + insert fluoro) ────────────

async function handleRiskBulk(body: RiskBulkBody, res: Res) {
  if (!Array.isArray(body.updates)) {
    res.status(400).json({ error: 'updates[] required' });
    return;
  }
  const supabase = getSupabaseAdmin();
  let patientsUpdated = 0;
  let fluoroAdded = 0;
  let externalCreated = 0;

  // 1) Create external patients first → get their ids → fold into updates list.
  const externalUpdates: RiskUpdate[] = [];
  const ext = body.create_external ?? [];
  if (ext.length > 0) {
    const rows = ext.map((e) => ({
      surname: e.surname,
      first_name: e.first_name,
      patronymic: e.patronymic,
      birth_date: e.birth_date,
      location_id: e.location_id,
      tb_status: 'external' as const,
      social_risk_groups: e.add_social,
      medical_risk_groups: [],
      diagnoses_codes: [],
    }));
    for (const chunk of chunked(rows, 500)) {
      const { data, error } = await supabase.from('patients').insert(chunk).select('id, surname, first_name, birth_date');
      if (error) {
        res.status(500).json({ error: `external insert: ${error.message}` });
        return;
      }
      for (const created of data ?? []) {
        const match = ext.find(
          (e) => e.surname === created.surname && e.first_name === created.first_name && e.birth_date === created.birth_date,
        );
        if (match && match.add_fluoro && match.add_fluoro.length > 0) {
          externalUpdates.push({ id: created.id as string, add_social: [], add_fluoro: match.add_fluoro });
        }
        externalCreated += 1;
      }
    }
  }

  // 2) Merge social_risk_groups for existing patients.
  const ids = body.updates.map((u) => u.id);
  const currentMap = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, social_risk_groups')
      .in('id', ids);
    if (error) {
      res.status(500).json({ error: `lookup: ${error.message}` });
      return;
    }
    for (const p of data ?? []) {
      currentMap.set(p.id as string, (p.social_risk_groups ?? []) as string[]);
    }
  }

  const fluoroInserts: Record<string, unknown>[] = [];

  for (const u of body.updates) {
    const cur = currentMap.get(u.id) ?? [];
    const merged = Array.from(new Set([...cur, ...u.add_social]));
    if (merged.length !== cur.length || merged.some((m, i) => m !== cur[i])) {
      const { error } = await supabase
        .from('patients')
        .update({ social_risk_groups: merged })
        .eq('id', u.id);
      if (error) {
        res.status(500).json({ error: `update ${u.id}: ${error.message}` });
        return;
      }
      patientsUpdated += 1;
    }

    for (const f of u.add_fluoro ?? []) {
      fluoroInserts.push({
        patient_id: u.id,
        date: f.date,
        result: f.result,
        result_code: f.result_code,
        next_planned_date: f.next_planned_date,
        source: 'imported_xlsx',
      });
    }
  }

  // Fluoro for newly created external patients.
  for (const u of externalUpdates) {
    for (const f of u.add_fluoro ?? []) {
      fluoroInserts.push({
        patient_id: u.id,
        date: f.date,
        result: f.result,
        result_code: f.result_code,
        next_planned_date: f.next_planned_date,
        source: 'imported_xlsx',
      });
    }
  }

  const dedupedFluoro = await dedupeFluoro(supabase, fluoroInserts as FluoroInsert[]);
  for (const chunk of chunked(dedupedFluoro, 500)) {
    const { error, count } = await supabase
      .from('fluorography')
      .insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `fluoro insert: ${error.message}` });
      return;
    }
    fluoroAdded += count ?? chunk.length;
  }

  res.status(200).json({ patientsUpdated, fluoroAdded, externalCreated });
}

// ── Status bulk (set detected/contact + fluoro/sputum) ─────────────────────

async function handleStatusBulk(body: StatusBulkBody, res: Res) {
  if (!Array.isArray(body.updates)) {
    res.status(400).json({ error: 'updates[] required' });
    return;
  }
  const supabase = getSupabaseAdmin();
  let statusChanged = 0;
  let fluoroAdded = 0;
  let sputumAdded = 0;
  let externalCreated = 0;

  const fluoroInserts: Record<string, unknown>[] = [];
  const sputumInserts: Record<string, unknown>[] = [];

  // 1) Create external patients with their tb_status; remember their ids for fluoro/sputum.
  const ext = body.create_external ?? [];
  if (ext.length > 0) {
    const rows = ext.map((e) => ({
      surname: e.surname,
      first_name: e.first_name,
      patronymic: e.patronymic,
      birth_date: e.birth_date,
      location_id: e.location_id,
      tb_status: e.tb_status,
      medical_risk_groups: [],
      social_risk_groups: [],
      diagnoses_codes: [],
    }));
    for (const chunk of chunked(rows, 500)) {
      const { data, error } = await supabase.from('patients').insert(chunk).select('id, surname, first_name, birth_date');
      if (error) {
        res.status(500).json({ error: `external insert: ${error.message}` });
        return;
      }
      for (const created of data ?? []) {
        const match = ext.find(
          (e) => e.surname === created.surname && e.first_name === created.first_name && e.birth_date === created.birth_date,
        );
        if (!match) continue;
        externalCreated += 1;
        for (const f of match.add_fluoro ?? []) {
          fluoroInserts.push({
            patient_id: created.id as string,
            date: f.date,
            result: f.result,
            result_code: f.result_code,
            source: 'imported_xlsx',
          });
        }
        for (const s of match.add_sputum ?? []) {
          sputumInserts.push({
            patient_id: created.id as string,
            date: s.date,
            test_type: s.test_type,
            result: s.result,
          });
        }
      }
    }
  }

  for (const u of body.updates) {
    const { error } = await supabase
      .from('patients')
      .update({ tb_status: u.tb_status })
      .eq('id', u.id);
    if (error) {
      res.status(500).json({ error: `status ${u.id}: ${error.message}` });
      return;
    }
    statusChanged += 1;

    for (const f of u.add_fluoro ?? []) {
      fluoroInserts.push({
        patient_id: u.id,
        date: f.date,
        result: f.result,
        result_code: f.result_code,
        source: 'imported_xlsx',
      });
    }
    for (const s of u.add_sputum ?? []) {
      sputumInserts.push({
        patient_id: u.id,
        date: s.date,
        test_type: s.test_type,
        result: s.result,
      });
    }
  }

  const dedupedFluoroStatus = await dedupeFluoro(supabase, fluoroInserts as FluoroInsert[]);
  for (const chunk of chunked(dedupedFluoroStatus, 500)) {
    const { error, count } = await supabase.from('fluorography').insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `fluoro: ${error.message}` });
      return;
    }
    fluoroAdded += count ?? chunk.length;
  }

  const dedupedSputum = await dedupeSputum(supabase, sputumInserts as SputumInsert[]);
  for (const chunk of chunked(dedupedSputum, 500)) {
    const { error, count } = await supabase.from('sputum_tests').insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `sputum: ${error.message}` });
      return;
    }
    sputumAdded += count ?? chunk.length;
  }

  res.status(200).json({ statusChanged, fluoroAdded, sputumAdded, externalCreated });
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// ── Idempotency helpers — skip rows that already exist in the DB ───────────

type FluoroInsert = { patient_id: string; date: string; result_code: string; [k: string]: unknown };
type SputumInsert = { patient_id: string; date: string; test_type: string; [k: string]: unknown };

async function dedupeFluoro(supabase: ReturnType<typeof getSupabaseAdmin>, rows: FluoroInsert[]): Promise<FluoroInsert[]> {
  if (rows.length === 0) return rows;
  const patientIds = Array.from(new Set(rows.map((r) => r.patient_id)));
  const existing = new Set<string>();
  for (const chunk of chunked(patientIds, 500)) {
    const { data, error } = await supabase
      .from('fluorography')
      .select('patient_id, date, result_code')
      .in('patient_id', chunk);
    if (error) throw new Error(`fluoro dedupe lookup: ${error.message}`);
    for (const r of data ?? []) existing.add(`${r.patient_id}|${r.date}|${r.result_code}`);
  }
  const seen = new Set<string>();
  const out: FluoroInsert[] = [];
  for (const r of rows) {
    const k = `${r.patient_id}|${r.date}|${r.result_code}`;
    if (existing.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

async function dedupeSputum(supabase: ReturnType<typeof getSupabaseAdmin>, rows: SputumInsert[]): Promise<SputumInsert[]> {
  if (rows.length === 0) return rows;
  const patientIds = Array.from(new Set(rows.map((r) => r.patient_id)));
  const existing = new Set<string>();
  for (const chunk of chunked(patientIds, 500)) {
    const { data, error } = await supabase
      .from('sputum_tests')
      .select('patient_id, date, test_type')
      .in('patient_id', chunk);
    if (error) throw new Error(`sputum dedupe lookup: ${error.message}`);
    for (const r of data ?? []) existing.add(`${r.patient_id}|${r.date}|${r.test_type}`);
  }
  const seen = new Set<string>();
  const out: SputumInsert[] = [];
  for (const r of rows) {
    const k = `${r.patient_id}|${r.date}|${r.test_type}`;
    if (existing.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
