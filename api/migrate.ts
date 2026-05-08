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

type RiskBulkBody = {
  action: 'risk-groups-bulk';
  updates: {
    id: string;
    add_social: string[];
    add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null; next_planned_date: string | null }[];
  }[];
};

type StatusBulkBody = {
  action: 'status-bulk';
  updates: {
    id: string;
    tb_status: 'detected' | 'contact';
    add_fluoro?: { date: string; result_code: FluoroResultCode; result: string | null }[];
    add_sputum?: { date: string; test_type: string; result: string | null }[];
  }[];
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

  let added = 0;
  for (const chunk of chunked(inserts, 500)) {
    const { error, count } = await supabase
      .from('fluorography')
      .insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `insert: ${error.message}` });
      return;
    }
    added += count ?? chunk.length;
  }

  res.status(200).json({ added, skipped, matched: inserts.length });
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

  for (const chunk of chunked(fluoroInserts, 500)) {
    const { error, count } = await supabase
      .from('fluorography')
      .insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `fluoro insert: ${error.message}` });
      return;
    }
    fluoroAdded += count ?? chunk.length;
  }

  res.status(200).json({ patientsUpdated, fluoroAdded });
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

  const fluoroInserts: Record<string, unknown>[] = [];
  const sputumInserts: Record<string, unknown>[] = [];

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

  for (const chunk of chunked(fluoroInserts, 500)) {
    const { error, count } = await supabase.from('fluorography').insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `fluoro: ${error.message}` });
      return;
    }
    fluoroAdded += count ?? chunk.length;
  }

  for (const chunk of chunked(sputumInserts, 500)) {
    const { error, count } = await supabase.from('sputum_tests').insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `sputum: ${error.message}` });
      return;
    }
    sputumAdded += count ?? chunk.length;
  }

  res.status(200).json({ statusChanged, fluoroAdded, sputumAdded });
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
