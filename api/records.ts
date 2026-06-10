import { getSupabaseAdmin } from './_lib/supabase-server.js';
import { requireAuth } from './_lib/auth-guard.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = {
  status: (code: number) => Res;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

type Kind = 'fluoro' | 'sputum' | 'quantiferon' | 'adpm';

const TABLES: Record<Kind, string> = {
  fluoro: 'fluorography',
  sputum: 'sputum_tests',
  quantiferon: 'quantiferon_tests',
  adpm: 'adpm_vaccinations',
};

const ALLOWED_FIELDS: Record<Kind, Set<string>> = {
  fluoro: new Set(['date', 'result', 'result_code', 'next_planned_date', 'notes']),
  sputum: new Set(['date', 'test_type', 'result', 'notes']),
  quantiferon: new Set(['date', 'result', 'result_code', 'notes']),
  adpm: new Set(['date', 'vaccine_name', 'manufacturer', 'lot_number', 'notes']),
};

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function handler(req: Req, res: Res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const q = req.query ?? {};
  const kind = asString(q.kind) as Kind | undefined;
  if (
    kind !== 'fluoro' &&
    kind !== 'sputum' &&
    kind !== 'quantiferon' &&
    kind !== 'adpm'
  ) {
    res.status(400).json({ error: "kind must be 'fluoro' | 'sputum' | 'quantiferon' | 'adpm'" });
    return;
  }
  const table = TABLES[kind];
  const supabase = getSupabaseAdmin();

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patientId = body.patient_id as string | undefined;
    const date = body.date as string | undefined;
    if (!patientId || !date) {
      res.status(400).json({ error: 'patient_id и date обовʼязкові' });
      return;
    }
    const row: Record<string, unknown> = { patient_id: patientId, date, doctor_id: session.doctor_id };
    if (kind === 'fluoro') {
      row.result = body.result ?? null;
      row.result_code = body.result_code ?? 'unknown';
      row.next_planned_date = body.next_planned_date ?? null;
      row.notes = body.notes ?? null;
      row.source = 'manual';
    } else if (kind === 'sputum') {
      row.test_type = body.test_type ?? 'xpert';
      row.result = body.result ?? null;
      row.notes = body.notes ?? null;
    } else if (kind === 'quantiferon') {
      row.result = body.result ?? null;
      row.result_code = body.result_code ?? 'unknown';
      row.notes = body.notes ?? null;
    } else {
      // adpm
      row.vaccine_name = body.vaccine_name ?? null;
      row.manufacturer = body.manufacturer ?? null;
      row.lot_number = body.lot_number ?? null;
      row.notes = body.notes ?? null;
      row.source = 'manual';
    }
    const { data, error } = await supabase.from(table).insert(row).select('*').maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ record: data });
    return;
  }

  const id = asString(q.id);
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowed = ALLOWED_FIELDS[kind];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('doctor_id', session.doctor_id).select('*').maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ record: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('doctor_id', session.doctor_id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
