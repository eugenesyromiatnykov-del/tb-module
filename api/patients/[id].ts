import { getSupabaseAdmin } from '../_lib/supabase-server.js';
import { requireAuth } from '../_lib/auth-guard.js';

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

const PATIENT_FIELDS = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, tb_status, contact_of,
  medical_risk_groups, social_risk_groups, diagnoses_codes, diagnoses_synced_at,
  notes, archived, archived_reason, archived_at, created_at, updated_at
`;

const ALLOWED_PATCH_FIELDS = new Set([
  'phone',
  'address',
  'location_id',
  'tb_status',
  'social_risk_groups',
  'medical_risk_groups',
  'is_external',
  'notes',
  'contact_of',
  'archived',
  'archived_reason',
]);

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;

  const id = asString(req.query?.id);
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    const [patientRes, fluoroRes, sputumRes] = await Promise.all([
      supabase.from('patients').select(PATIENT_FIELDS).eq('id', id).maybeSingle(),
      supabase.from('fluorography').select('*').eq('patient_id', id).order('date', { ascending: false }),
      supabase.from('sputum_tests').select('*').eq('patient_id', id).order('date', { ascending: false }),
    ]);
    if (patientRes.error) {
      res.status(500).json({ error: patientRes.error.message });
      return;
    }
    if (!patientRes.data) {
      res.status(404).json({ error: 'Пацієнта не знайдено' });
      return;
    }
    res.status(200).json({
      patient: patientRes.data,
      fluorography: fluoroRes.data ?? [],
      sputum_tests: sputumRes.data ?? [],
    });
    return;
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_PATCH_FIELDS.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    const { data, error } = await supabase
      .from('patients')
      .update(patch)
      .eq('id', id)
      .select(PATIENT_FIELDS)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ patient: data });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
