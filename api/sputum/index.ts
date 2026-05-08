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

type IncomingSputum = {
  patient_id: string;
  date: string;
  test_type?: 'xpert' | 'microscopy' | 'culture' | 'pcr';
  result?: string | null;
  notes?: string | null;
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<IncomingSputum>;
  if (!body.patient_id || !body.date) {
    res.status(400).json({ error: 'patient_id и date обовʼязкові' });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('sputum_tests')
    .insert({
      patient_id: body.patient_id,
      date: body.date,
      test_type: body.test_type ?? 'xpert',
      result: body.result ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ sputum_test: data });
}
