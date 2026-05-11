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

type Result = 'low_risk' | 'needs_xray' | 'needs_referral';

type QuestionnaireBody = {
  patient_id?: string | null;
  answers: Record<string, unknown>;
  result: Result;
  filled_by?: string | null;
  notes?: string | null;
};

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;

  const supabase = getSupabaseAdmin();
  const q = req.query ?? {};
  const id = asString(q.id);

  if (req.method === 'GET') {
    if (id) {
      const { data, error } = await supabase
        .from('questionnaires')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'Опросник не знайдено' });
        return;
      }
      // Optionally include patient.
      let patient: unknown = null;
      if (data.patient_id) {
        const r = await supabase
          .from('patients')
          .select('id, surname, first_name, patronymic, birth_date, location_id, address, phone, medics_id')
          .eq('id', data.patient_id)
          .maybeSingle();
        patient = r.data ?? null;
      }
      res.status(200).json({ questionnaire: data, patient });
      return;
    }

    const patientId = asString(q.patient_id);
    const result = asString(q.result);
    let query = supabase
      .from('questionnaires')
      .select('id, patient_id, filled_at, result, filled_by, answers, notes')
      .order('filled_at', { ascending: false })
      .limit(500);
    if (patientId) query = query.eq('patient_id', patientId);
    if (result) query = query.eq('result', result);
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ questionnaires: data ?? [] });
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Partial<QuestionnaireBody>;
    if (!body.answers || typeof body.answers !== 'object') {
      res.status(400).json({ error: 'answers (object) обовʼязкові' });
      return;
    }
    if (!body.result || !['low_risk', 'needs_xray', 'needs_referral'].includes(body.result)) {
      res.status(400).json({ error: 'result має бути low_risk | needs_xray | needs_referral' });
      return;
    }
    const row = {
      patient_id: body.patient_id ?? null,
      answers: body.answers,
      result: body.result,
      filled_by: body.filled_by ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await supabase.from('questionnaires').insert(row).select('*').maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ questionnaire: data });
    return;
  }

  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }
    const { error } = await supabase.from('questionnaires').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
