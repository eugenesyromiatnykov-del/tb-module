import { getSupabaseAdmin } from '../_lib/supabase-server.js';
import { requireAuth } from '../_lib/auth-guard.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

const SELECT_FULL = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, tb_status, contact_of,
  medical_risk_groups, social_risk_groups, diagnoses_codes, diagnoses_synced_at,
  notes, archived, archived_reason, archived_at, created_at, updated_at
`;

const SELECT_FOR_DIFF = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, archived
`;

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = getSupabaseAdmin();
  const q = req.query ?? {};
  const mode = asString(q.mode);

  // Diff mode: lightweight fetch of all patients (incl. archived) for client-side diff.
  if (mode === 'diff') {
    const { data, error } = await supabase
      .from('patients')
      .select(SELECT_FOR_DIFF)
      .order('medics_id', { ascending: true })
      .limit(20000);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ patients: data ?? [] });
    return;
  }

  // Default mode: full registry with filters.
  const location = asString(q.location); // 'bilohirska' | 'zaluzhe' | undefined
  const status = asString(q.status); // tb_status enum value
  const includeArchived = asString(q.archived) === '1';
  const search = (asString(q.search) ?? '').trim();

  let query = supabase
    .from('patients')
    .select(SELECT_FULL)
    .order('surname', { ascending: true })
    .limit(5000);

  if (!includeArchived) query = query.eq('archived', false);
  if (location) query = query.eq('location_id', location);
  if (status) query = query.eq('tb_status', status);
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      `surname.ilike.${like},first_name.ilike.${like},patronymic.ilike.${like},medics_id.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ patients: data ?? [] });
}
