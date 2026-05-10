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

const SELECT_FULL = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, tb_status, contact_of,
  medical_risk_groups, social_risk_groups, diagnoses_codes, diagnoses_synced_at,
  notes, archived, archived_reason, archived_at, created_at, updated_at,
  last_fluoro_date, next_planned_date, last_result_code
`;

const SELECT_FOR_DIFF = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, location_id, archived
`;

type Filter = 'overdue' | 'this_week' | 'next_30' | 'no_fluoro' | 'contacts_no_fluoro' | 'detected' | 'all_active';

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function applyFilter<Q extends { eq: Function; lt: Function; gt: Function; gte: Function; lte: Function; is: Function; not: Function }>(
  q: Q,
  filter: Filter | undefined,
  location?: string,
): Q {
  let out = q.eq('archived', false) as Q;
  if (location) out = out.eq('location_id', location) as Q;

  const today = todayIso();
  switch (filter) {
    case 'overdue':
      out = out.lt('next_planned_date', today).not('next_planned_date', 'is', null) as Q;
      break;
    case 'this_week':
      out = out.gte('next_planned_date', today).lte('next_planned_date', daysFromNow(7)) as Q;
      break;
    case 'next_30':
      out = out.gt('next_planned_date', daysFromNow(7)).lte('next_planned_date', daysFromNow(30)) as Q;
      break;
    case 'no_fluoro':
      out = out.is('last_fluoro_date', null) as Q;
      break;
    case 'contacts_no_fluoro':
      out = out.eq('tb_status', 'contact').is('last_fluoro_date', null) as Q;
      break;
    case 'detected':
      out = out.eq('tb_status', 'detected') as Q;
      break;
    default:
      break;
  }
  return out;
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

  // ── Diff mode (lightweight, all patients incl. archived) ─────────────────
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

  // ── Stats mode (dashboard widgets) ───────────────────────────────────────
  if (mode === 'stats') {
    const filters: Filter[] = ['overdue', 'this_week', 'next_30', 'no_fluoro', 'contacts_no_fluoro', 'detected'];
    const out: Record<string, number> = {};
    for (const f of filters) {
      const base = supabase.from('patient_dashboard').select('id', { count: 'exact', head: true });
      const { count, error } = await applyFilter(base, f);
      if (error) {
        res.status(500).json({ error: `stats ${f}: ${error.message}` });
        return;
      }
      out[f] = count ?? 0;
    }
    // Last MIS import
    const { data: lastImport, error: liErr } = await supabase
      .from('mis_imports')
      .select('imported_at')
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (liErr) {
      res.status(500).json({ error: `lastImport: ${liErr.message}` });
      return;
    }
    out.lastImport_daysAgo = lastImport
      ? Math.floor((Date.now() - new Date(lastImport.imported_at as string).getTime()) / 86400_000)
      : -1;

    // Total active patients
    const { count: totalActive } = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('archived', false);
    out.totalActive = totalActive ?? 0;

    res.status(200).json({ stats: out });
    return;
  }

  // ── Default: registry list with filters ──────────────────────────────────
  const filter = asString(q.filter) as Filter | undefined;
  const location = asString(q.location);
  const status = asString(q.status);
  const includeArchived = asString(q.archived) === '1';
  const search = (asString(q.search) ?? '').trim();

  let query = supabase.from('patient_dashboard').select(SELECT_FULL);
  if (filter) {
    query = applyFilter(query, filter, location);
  } else {
    if (!includeArchived) query = query.eq('archived', false);
    if (location) query = query.eq('location_id', location);
  }
  if (status) query = query.eq('tb_status', status);
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      `surname.ilike.${like},first_name.ilike.${like},patronymic.ilike.${like},medics_id.ilike.${like}`,
    );
  }
  query = query.order('surname', { ascending: true }).limit(5000);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ patients: data ?? [] });
}
