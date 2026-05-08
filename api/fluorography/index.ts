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

type IncomingFluoro = {
  patient_id: string;
  date: string;
  result?: string | null;
  result_code?: 'normal' | 'pathology' | 'pending' | 'refused' | 'unknown';
  next_planned_date?: string | null;
  notes?: string | null;
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<IncomingFluoro>;
  if (!body.patient_id || !body.date) {
    res.status(400).json({ error: 'patient_id и date обовʼязкові' });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('fluorography')
    .insert({
      patient_id: body.patient_id,
      date: body.date,
      result: body.result ?? null,
      result_code: body.result_code ?? 'unknown',
      next_planned_date: body.next_planned_date ?? null,
      notes: body.notes ?? null,
      source: 'manual',
    })
    .select('*')
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ fluorography: data });
}
