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

// Read from the patient_dashboard view so derived columns (last_fluoro_date,
// last_sputum_*, last_quantiferon_*, next_planned_date) come back together
// with the base patient row.
const PATIENT_FIELDS = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, tb_status, contact_of,
  medical_risk_groups, social_risk_groups, diagnoses_codes, diagnoses_synced_at,
  notes, archived, archived_reason, archived_at, is_external,
  created_at, updated_at,
  last_fluoro_date, next_planned_date, last_result_code,
  last_sputum_date, last_sputum_test_type, last_sputum_result,
  last_quantiferon_date, last_quantiferon_result_code, last_quantiferon_result,
  last_adpm_date, next_adpm_date,
  adpm_contraindication, adpm_contraindication_reason,
  adpm_refused, adpm_refusal_date, adpm_refusal_photo_path
`;

const ALLOWED_PATCH_FIELDS = new Set([
  'medics_id',
  'surname',
  'first_name',
  'patronymic',
  'birth_date',
  'gender',
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
  'adpm_contraindication',
  'adpm_contraindication_reason',
  'adpm_refused',
  'adpm_refusal_date',
  'adpm_refusal_photo_path',
]);

const REFUSAL_BUCKET = 'adpm-refusals';

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

  const action = asString(req.query?.action);

  // ── Special actions: signed upload/download URLs for refusal photo ────────
  // Done as ?action=... dispatch to stay under Vercel Hobby 12-fn budget.
  if (action === 'adpm_refusal_upload') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST required' });
      return;
    }
    const body = (req.body ?? {}) as { content_type?: string; ext?: string };
    const ext = (body.ext || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
    const path = `${id}/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage
      .from(REFUSAL_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'upload url failed' });
      return;
    }
    res.status(200).json({
      path,
      upload_url: data.signedUrl,
      token: data.token,
      content_type: body.content_type ?? 'image/jpeg',
    });
    return;
  }

  if (action === 'adpm_refusal_photo') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'GET required' });
      return;
    }
    const { data: patient } = await supabase
      .from('patients')
      .select('adpm_refusal_photo_path')
      .eq('id', id)
      .maybeSingle();
    if (!patient?.adpm_refusal_photo_path) {
      res.status(404).json({ error: 'Фото відсутнє' });
      return;
    }
    const { data, error } = await supabase.storage
      .from(REFUSAL_BUCKET)
      .createSignedUrl(patient.adpm_refusal_photo_path, 60 * 10); // 10 min
    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'sign failed' });
      return;
    }
    res.status(200).json({ url: data.signedUrl });
    return;
  }

  if (req.method === 'GET') {
    const [patientRes, fluoroRes, sputumRes, quantRes, adpmRes] = await Promise.all([
      supabase.from('patient_dashboard').select(PATIENT_FIELDS).eq('id', id).maybeSingle(),
      supabase.from('fluorography').select('*').eq('patient_id', id).order('date', { ascending: false }),
      supabase.from('sputum_tests').select('*').eq('patient_id', id).order('date', { ascending: false }),
      supabase.from('quantiferon_tests').select('*').eq('patient_id', id).order('date', { ascending: false }),
      supabase.from('adpm_vaccinations').select('*').eq('patient_id', id).order('date', { ascending: false }),
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
      quantiferon_tests: quantRes.data ?? [],
      adpm_vaccinations: adpmRes.data ?? [],
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
    const { error: updErr } = await supabase.from('patients').update(patch).eq('id', id);
    if (updErr) {
      res.status(500).json({ error: updErr.message });
      return;
    }
    // Read back through the view so the response includes derived summary fields.
    const { data, error } = await supabase
      .from('patient_dashboard')
      .select(PATIENT_FIELDS)
      .eq('id', id)
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
