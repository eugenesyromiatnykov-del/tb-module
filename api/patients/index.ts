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
  notes, archived, archived_reason, archived_at, is_external, created_at, updated_at,
  last_fluoro_date, next_planned_date, last_result_code,
  last_adpm_date, next_adpm_date, adpm_contraindication, adpm_refused
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

function applyFilter<Q extends { eq: Function; lt: Function; gt: Function; gte: Function; lte: Function; is: Function; not: Function; contains: Function }>(
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
      // After the 0006 refactor "контактний" is a social_risk_group, not a status.
      out = out.contains('social_risk_groups', ['close_contact']).is('last_fluoro_date', null) as Q;
      break;
    case 'detected':
      out = out.eq('tb_status', 'detected') as Q;
      break;
    default:
      break;
  }
  return out;
}


const ALLOWED_CREATE_FIELDS = new Set([
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
  'contact_of',
  'social_risk_groups',
  'medical_risk_groups',
  'is_external',
  'notes',
]);

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;

  const supabase = getSupabaseAdmin();

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_CREATE_FIELDS.has(k)) row[k] = v;
    }
    if (!row.surname || !row.first_name || !row.birth_date) {
      res.status(400).json({ error: 'surname, first_name, birth_date — обовʼязкові' });
      return;
    }
    // Sensible defaults.
    if (!row.tb_status) row.tb_status = 'risk';
    if (!('medical_risk_groups' in row)) row.medical_risk_groups = [];
    if (!('social_risk_groups' in row)) row.social_risk_groups = [];
    if (!('diagnoses_codes' in row)) row.diagnoses_codes = [];

    const { data, error } = await supabase.from('patients').insert(row).select('*').maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ patient: data });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const q = req.query ?? {};
  const mode = asString(q.mode);

  // ── Diff mode (lightweight, all patients incl. archived) ─────────────────
  if (mode === 'diff') {
    const { data, error } = await supabase
      .from('patients')
      .select(SELECT_FOR_DIFF)
      .order('medics_id', { ascending: true })
      .range(0, 19999);
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
  const group = asString(q.group);
  const contactOf = asString(q.contact_of);
  const includeArchived = asString(q.archived) === '1';
  const externalParam = asString(q.external); // '1' = only external, '0' = only declarants, omit = both
  const search = (asString(q.search) ?? '').trim();
  const adpm = asString(q.adpm); // 'vaccinated' | 'contraindicated' | 'refused' | 'pending' | 'this_year' | 'overdue'
  const address = (asString(q.address) ?? '').trim();

  let query = supabase.from('patient_dashboard').select(SELECT_FULL);
  if (filter) {
    query = applyFilter(query, filter, location);
  } else {
    if (!includeArchived) query = query.eq('archived', false);
    if (location) query = query.eq('location_id', location);
  }
  if (status) query = query.eq('tb_status', status);
  if (contactOf) query = query.eq('contact_of', contactOf);
  if (externalParam === '1') query = query.eq('is_external', true);
  if (externalParam === '0') query = query.eq('is_external', false);

  if (group) {
    // PostgREST array-contains: cs.{key}. GIN indexes make this fast.
    query = query.or(`medical_risk_groups.cs.{${group}},social_risk_groups.cs.{${group}}`);
  }

  // АДП-М status filter (server-side so list page doesn't have to pull all rows).
  if (adpm === 'vaccinated') {
    query = query.not('last_adpm_date', 'is', null);
  } else if (adpm === 'contraindicated') {
    query = query.eq('adpm_contraindication', true);
  } else if (adpm === 'refused') {
    query = query.eq('adpm_refused', true);
  } else if (adpm === 'pending') {
    // Neither contraindicated nor refused (vaccinated or not).
    query = query.eq('adpm_contraindication', false).eq('adpm_refused', false);
  } else if (adpm === 'this_year') {
    // next_adpm_date falls in the current calendar year — revaccination due.
    const year = new Date().getFullYear();
    query = query
      .gte('next_adpm_date', `${year}-01-01`)
      .lte('next_adpm_date', `${year}-12-31`);
  } else if (adpm === 'overdue') {
    query = query.lt('next_adpm_date', todayIso()).not('next_adpm_date', 'is', null);
  }

  if (address) {
    query = query.ilike('address', `%${address}%`);
  }

  if (search) {
    const like = `%${search}%`;
    query = query.or(
      `surname.ilike.${like},first_name.ilike.${like},patronymic.ilike.${like},medics_id.ilike.${like}`,
    );
  }
  // Supabase REST API caps replies at 1000 rows by default — use range
  // to actually return everything that matches.
  query = query.order('surname', { ascending: true }).range(0, 9999);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ patients: data ?? [] });
}
