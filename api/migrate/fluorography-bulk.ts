import { getSupabaseAdmin } from '../_lib/supabase-server.js';
import { requireAuth } from '../_lib/auth-guard.js';

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

type FluoroRow = {
  medics_id: string;
  date: string;
  result?: string | null;
  result_code?: 'normal' | 'pathology' | 'pending' | 'refused' | 'unknown';
  next_planned_date?: string | null;
  notes?: string | null;
};

type Body = {
  rows: FluoroRow[];
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<Body>;
  if (!Array.isArray(body.rows)) {
    res.status(400).json({ error: 'rows[] required' });
    return;
  }

  const supabase = getSupabaseAdmin();

  // 1) Resolve medics_id → patient.id in chunks (Postgres 'in' has practical limits).
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

  // 2) Build inserts; skip rows without a matching patient.
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

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
