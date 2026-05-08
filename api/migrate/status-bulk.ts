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

type Body = {
  // patient.id → new tb_status + optional fluoro/sputum to insert
  updates: {
    id: string;
    tb_status: 'detected' | 'contact';
    add_fluoro?: { date: string; result_code: string; result: string | null }[];
    add_sputum?: { date: string; test_type: string; result: string | null }[];
  }[];
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<Body>;
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
