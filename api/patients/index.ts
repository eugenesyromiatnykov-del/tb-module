import { getSupabaseAdmin } from '../_lib/supabase-server.js';
import { requireAuth } from '../_lib/auth-guard.js';
import { handlePreflight, setCors } from '../_lib/cors.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (key: string, value: string | string[]) => void;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

const SELECT_FULL = `
  id, medics_id, surname, first_name, patronymic, birth_date, gender,
  phone, address, village, location_id, tb_status, contact_of,
  medical_risk_groups, social_risk_groups, diagnoses_codes, diagnoses_detail, diagnoses_synced_at,
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

function applyFilter<Q extends { eq: Function; neq: Function; lt: Function; gt: Function; gte: Function; lte: Function; is: Function; not: Function; contains: Function }>(
  q: Q,
  filter: Filter | undefined,
  location?: string,
): Q {
  // Cleared patients are out of the fluoro registry — never count them in
  // overdue / this_week / no_fluoro / etc. quick filters or dashboard stats.
  let out = q.eq('archived', false).neq('tb_status', 'cleared') as Q;
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
  'village',
  'location_id',
  'tb_status',
  'contact_of',
  'social_risk_groups',
  'medical_risk_groups',
  'is_external',
  'notes',
]);

export default async function handler(req: Req, res: Res) {
  if (handlePreflight(req, res)) return;
  setCors(req, res);
  if (!(await requireAuth(req, res))) return;

  const supabase = getSupabaseAdmin();
  const reqMode = asString((req.query ?? {}).mode);

  // ── Sync-job dispatcher (action lives in body.action for POST) ───────────
  if (reqMode === 'sync_job') {
    return handleSyncJob(req, res, supabase);
  }

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

  // ── Report mode: same filters as default, but joins recent fluoro /
  // sputum xpert / quantiferon / latest questionnaire so a single round-trip
  // gives the export everything for the 20-column reporting template.
  if (mode === 'report') {
    try {
    const filter = asString(q.filter) as Filter | undefined;
    const location = asString(q.location);
    const status = asString(q.status);
    const group = asString(q.group);
    const includeArchived = asString(q.archived) === '1';
    const externalParam = asString(q.external);
    const search = (asString(q.search) ?? '').trim();
    const clearedParam = asString(q.cleared);
    const adpmRaw = (asString(q.adpm) ?? '').trim();
    const adpmValues = adpmRaw ? adpmRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const address = (asString(q.address) ?? '').trim();
    const villageParam = (asString(q.village) ?? '').trim();
    const villages = villageParam ? villageParam.split(',').map((v) => v.trim()).filter(Boolean) : [];

    let pQuery = supabase.from('patient_dashboard').select(SELECT_FULL);
    if (filter) pQuery = applyFilter(pQuery, filter, location);
    else {
      if (!includeArchived) pQuery = pQuery.eq('archived', false);
      if (location) pQuery = pQuery.eq('location_id', location);
    }
    if (status) pQuery = pQuery.eq('tb_status', status);
    else if (clearedParam === 'only') pQuery = pQuery.eq('tb_status', 'cleared');
    else if (clearedParam !== 'include') pQuery = pQuery.neq('tb_status', 'cleared');
    if (externalParam === '1') pQuery = pQuery.eq('is_external', true);
    if (externalParam === '0') pQuery = pQuery.eq('is_external', false);
    if (group) pQuery = pQuery.or(`medical_risk_groups.cs.{${group}},social_risk_groups.cs.{${group}}`);
    if (address) pQuery = pQuery.ilike('address', `%${address}%`);
    if (villages.length > 0) pQuery = pQuery.in('village', villages);
    if (adpmValues.length > 0) {
      const year = new Date().getFullYear();
      const today = todayIso();
      const parts: string[] = [];
      for (const v of adpmValues) {
        if (v === 'vaccinated') parts.push('last_adpm_date.not.is.null');
        else if (v === 'contraindicated') parts.push('adpm_contraindication.eq.true');
        else if (v === 'refused') parts.push('adpm_refused.eq.true');
        else if (v === 'pending') parts.push('and(adpm_contraindication.eq.false,adpm_refused.eq.false)');
        else if (v === 'this_year') parts.push(`and(next_adpm_date.gte.${year}-01-01,next_adpm_date.lte.${year}-12-31)`);
        else if (v === 'overdue') parts.push(`and(next_adpm_date.lt.${today},next_adpm_date.not.is.null)`);
      }
      if (parts.length > 0) pQuery = pQuery.or(parts.join(','));
    }
    if (search) {
      const like = `%${search}%`;
      pQuery = pQuery.or(
        `surname.ilike.${like},first_name.ilike.${like},patronymic.ilike.${like},medics_id.ilike.${like}`,
      );
    }
    pQuery = pQuery.order('surname', { ascending: true }).range(0, 9999);
    const { data: patients, error: pErr } = await pQuery;
    if (pErr) {
      res.status(500).json({ error: pErr.message });
      return;
    }

    const ids = (patients ?? []).map((p) => p.id as string);
    if (ids.length === 0) {
      res.status(200).json({ rows: [] });
      return;
    }

    // Fan-out joins. Order DESC so first-seen-per-patient = latest.
    // .in() ships the id list in the URL — with thousands of UUIDs the
    // query string blows past PostgREST's URL length limit, so we chunk.
    const CHUNK = 200;
    const idChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) idChunks.push(ids.slice(i, i + CHUNK));

    async function fetchChunked<T>(
      build: (chunk: string[]) => Promise<{ data: T[] | null; error: { message: string } | null }>,
    ): Promise<T[]> {
      const out: T[] = [];
      for (const chunk of idChunks) {
        const { data, error } = await build(chunk);
        if (error) throw new Error(error.message);
        if (data) out.push(...data);
      }
      return out;
    }

    type FluoroRow = { patient_id: string; date: string; result: string | null; result_code: string };
    type SputumRow = { patient_id: string; date: string; test_type: string; result: string | null };
    type QuantRow = { patient_id: string; date: string; result: string | null; result_code: string };
    type QuestRow = { patient_id: string; filled_at: string; result: string };

    const [fluoroRows, sputumRows, quantRows, questRows] = await Promise.all([
      fetchChunked<FluoroRow>((chunk) =>
        supabase
          .from('fluorography')
          .select('patient_id,date,result,result_code')
          .in('patient_id', chunk)
          .gte('date', '2024-01-01')
          .order('date', { ascending: false })
          .range(0, 19999) as unknown as Promise<{ data: FluoroRow[] | null; error: { message: string } | null }>,
      ),
      fetchChunked<SputumRow>((chunk) =>
        supabase
          .from('sputum_tests')
          .select('patient_id,date,test_type,result')
          .in('patient_id', chunk)
          .eq('test_type', 'xpert')
          .order('date', { ascending: false })
          .range(0, 19999) as unknown as Promise<{ data: SputumRow[] | null; error: { message: string } | null }>,
      ),
      fetchChunked<QuantRow>((chunk) =>
        supabase
          .from('quantiferon_tests')
          .select('patient_id,date,result,result_code')
          .in('patient_id', chunk)
          .order('date', { ascending: false })
          .range(0, 19999) as unknown as Promise<{ data: QuantRow[] | null; error: { message: string } | null }>,
      ),
      fetchChunked<QuestRow>((chunk) =>
        supabase
          .from('questionnaires')
          .select('patient_id,filled_at,result')
          .in('patient_id', chunk)
          .order('filled_at', { ascending: false })
          .range(0, 19999) as unknown as Promise<{ data: QuestRow[] | null; error: { message: string } | null }>,
      ),
    ]);

    const fluoroByPat = new Map<string, Array<{ date: string; result: string | null; result_code: string }>>();
    for (const f of fluoroRows) {
      const arr = fluoroByPat.get(f.patient_id) ?? [];
      arr.push({ date: f.date, result: f.result, result_code: f.result_code });
      fluoroByPat.set(f.patient_id, arr);
    }
    const latestBy = <T extends { patient_id: string }>(rows: T[]): Map<string, T> => {
      const m = new Map<string, T>();
      for (const r of rows) {
        if (!m.has(r.patient_id)) m.set(r.patient_id, r);
      }
      return m;
    };
    const xpert = latestBy(sputumRows);
    const quant = latestBy(quantRows);
    const quest = latestBy(questRows);

    const rows = (patients ?? []).map((p) => ({
      ...p,
      fluoro: fluoroByPat.get(p.id as string) ?? [],
      xpert: xpert.get(p.id as string) ?? null,
      quantiferon: quant.get(p.id as string) ?? null,
      questionnaire: quest.get(p.id as string) ?? null,
    }));
      res.status(200).json({ rows });
      return;
    } catch (e) {
      console.error('[/api/patients?mode=report] crashed:', e);
      const err = e as Error;
      res.status(500).json({
        error: `report mode crashed: ${err.message}`,
        stack: err.stack,
      });
      return;
    }
  }

  // ── Sync meta: aggregate freshness info for the table-page indicators ────
  if (mode === 'sync_meta') {
    const { data: maxRow, error: e1 } = await supabase
      .from('patients')
      .select('diagnoses_synced_at')
      .not('diagnoses_synced_at', 'is', null)
      .order('diagnoses_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) { res.status(500).json({ error: e1.message }); return; }
    const totalRes = await supabase.from('patients').select('id', { count: 'exact', head: true }).eq('archived', false);
    const syncedRes = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('archived', false)
      .not('diagnoses_synced_at', 'is', null);
    res.status(200).json({
      most_recent_synced_at: maxRow?.diagnoses_synced_at ?? null,
      total: totalRes.count ?? 0,
      synced: syncedRes.count ?? 0,
    });
    return;
  }

  // ── Batch-queue mode: feeds extension's nightly auto-analyze runner ──────
  // Returns only what's needed to drive MIS: medics_id (to type into search),
  // surname (for progress UI), location_id (to pick the right workplace radio).
  if (mode === 'batch_queue') {
    const location = asString(q.location);
    const onlyUnsynced = asString(q.only_unsynced) === '1';
    const limit = Math.max(1, Math.min(5000, parseInt(asString(q.limit) ?? '5000', 10) || 5000));
    let bq = supabase
      .from('patients')
      .select('id,medics_id,surname,first_name,patronymic,location_id,diagnoses_synced_at')
      .eq('archived', false)
      .not('medics_id', 'is', null);
    if (location) bq = bq.eq('location_id', location);
    if (onlyUnsynced) bq = bq.is('diagnoses_synced_at', null);
    bq = bq.order('surname', { ascending: true }).range(0, limit - 1);
    const { data, error } = await bq;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ queue: data ?? [] });
    return;
  }

  // ── Villages mode: distinct list for the multi-select filter ────────────
  if (mode === 'villages') {
    const { data, error } = await supabase
      .from('patients')
      .select('village')
      .not('village', 'is', null)
      .eq('archived', false)
      .order('village', { ascending: true })
      .range(0, 19999);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const set = new Set<string>();
    for (const row of (data ?? []) as Array<{ village: string | null }>) {
      const v = (row.village ?? '').trim();
      if (v) set.add(v);
    }
    res.status(200).json({ villages: Array.from(set).sort((a, b) => a.localeCompare(b, 'uk')) });
    return;
  }

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

  // ── Indicators report: cross-join indicator_results × patients with
  // optional rule/state/location/search filters. Used by the /indicators
  // page in the web app. Returns flat rows — one per (patient, rule).
  if (mode === 'indicators') {
    const ruleId = asString(q.rule_id);
    const stateParam = asString(q.state);
    const location = asString(q.location);
    const search = (asString(q.search) ?? '').trim();
    let qb = supabase
      .from('indicator_results')
      .select(`
        id, patient_id, rule_id, rule_name, rule_category, rule_type,
        applicability_reason, state, is_overdue,
        completed_count, total_count, last_date, next_date,
        frequency_months, required_actions, details, analyzed_at,
        patients!inner (
          id, medics_id, surname, first_name, patronymic, birth_date,
          gender, location_id, archived, tb_status,
          medical_risk_groups, social_risk_groups,
          last_indicators_synced_at
        )
      `)
      .order('analyzed_at', { ascending: false });
    if (ruleId) qb = qb.eq('rule_id', ruleId);
    if (stateParam) {
      const states = stateParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (states.length === 1) qb = qb.eq('state', states[0]);
      else if (states.length > 1) qb = qb.in('state', states);
    }
    if (location) qb = qb.eq('patients.location_id', location);
    qb = qb.eq('patients.archived', false);
    if (search) {
      const like = `%${search}%`;
      qb = qb.or(
        `surname.ilike.${like},first_name.ilike.${like},patronymic.ilike.${like},medics_id.ilike.${like}`,
        { foreignTable: 'patients' },
      );
    }
    qb = qb.range(0, 9999);
    const { data, error } = await qb;
    if (error) {
      res.status(500).json({ error: `indicators: ${error.message}` });
      return;
    }
    res.status(200).json({ rows: data ?? [] });
    return;
  }

  // ── Indicator summary: aggregate counts per (rule_id, state) optionally
  // scoped to a location. Drives the registry's summary header.
  if (mode === 'indicators_summary') {
    const location = asString(q.location);
    let qb = supabase
      .from('indicator_results')
      .select('rule_id, rule_name, state, patients!inner(location_id, archived)')
      .eq('patients.archived', false)
      .range(0, 99999);
    if (location) qb = qb.eq('patients.location_id', location);
    const { data, error } = await qb;
    if (error) {
      res.status(500).json({ error: `indicators_summary: ${error.message}` });
      return;
    }
    // Aggregate in JS — Supabase doesn't expose GROUP BY through PostgREST.
    type Bucket = { rule_id: string; rule_name: string | null; counts: Record<string, number>; total: number };
    const by = new Map<string, Bucket>();
    for (const r of data ?? []) {
      const id = r.rule_id as string;
      let b = by.get(id);
      if (!b) {
        b = { rule_id: id, rule_name: (r as { rule_name?: string | null }).rule_name ?? null, counts: {}, total: 0 };
        by.set(id, b);
      }
      const st = r.state as string;
      b.counts[st] = (b.counts[st] ?? 0) + 1;
      b.total += 1;
    }
    res.status(200).json({ summary: Array.from(by.values()).sort((a, b) => a.rule_id.localeCompare(b.rule_id)) });
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
  const adpmRaw = (asString(q.adpm) ?? '').trim();
  const adpmValues = adpmRaw ? adpmRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const address = (asString(q.address) ?? '').trim();
  const villageParam = (asString(q.village) ?? '').trim();
  const villages = villageParam ? villageParam.split(',').map((v) => v.trim()).filter(Boolean) : [];
  // 'cleared' patients are confirmed not to need fluoro monitoring; hide
  // them from the registry by default. The vaccinations page passes
  // ?cleared=include to keep them.
  const clearedParam = asString(q.cleared); // undefined | 'include' | 'only'

  let query = supabase.from('patient_dashboard').select(SELECT_FULL);
  if (filter) {
    query = applyFilter(query, filter, location);
  } else {
    if (!includeArchived) query = query.eq('archived', false);
    if (location) query = query.eq('location_id', location);
  }
  if (status) query = query.eq('tb_status', status);
  else if (clearedParam === 'only') query = query.eq('tb_status', 'cleared');
  else if (clearedParam !== 'include') query = query.neq('tb_status', 'cleared');
  if (contactOf) query = query.eq('contact_of', contactOf);
  if (externalParam === '1') query = query.eq('is_external', true);
  if (externalParam === '0') query = query.eq('is_external', false);

  if (group) {
    // PostgREST array-contains: cs.{key}. GIN indexes make this fast.
    query = query.or(`medical_risk_groups.cs.{${group}},social_risk_groups.cs.{${group}}`);
  }

  // АДП-М status filter — multi-select, OR-combined. Each value translates to a
  // (possibly compound) PostgREST condition, joined inside an or(...) expression.
  if (adpmValues.length > 0) {
    const year = new Date().getFullYear();
    const today = todayIso();
    const parts: string[] = [];
    for (const v of adpmValues) {
      if (v === 'vaccinated') parts.push('last_adpm_date.not.is.null');
      else if (v === 'contraindicated') parts.push('adpm_contraindication.eq.true');
      else if (v === 'refused') parts.push('adpm_refused.eq.true');
      else if (v === 'pending') parts.push('and(adpm_contraindication.eq.false,adpm_refused.eq.false)');
      else if (v === 'this_year')
        parts.push(`and(next_adpm_date.gte.${year}-01-01,next_adpm_date.lte.${year}-12-31)`);
      else if (v === 'overdue')
        parts.push(`and(next_adpm_date.lt.${today},next_adpm_date.not.is.null)`);
    }
    if (parts.length > 0) {
      query = query.or(parts.join(','));
    }
  }

  if (address) {
    query = query.ilike('address', `%${address}%`);
  }

  if (villages.length > 0) {
    query = query.in('village', villages);
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

// ─── sync_job dispatcher ────────────────────────────────────────────────────
// Single-active-job semantics: one row in 'queued|running|paused|stopped'
// status at a time. Web UI starts/stops; extension polls + heartbeats.
//
// Actions:
//   GET                    → returns the active job (or null)
//   POST {action:'start'}  → creates a new job, builds queue
//   POST {action:'heartbeat', job_id, cursor, failed, current_medics_id}
//   POST {action:'stop',   job_id}
//   POST {action:'resume', job_id}  → 24h rule: if last_heartbeat_at > 24h
//                                     ago, rebuild queue from scratch.
//   POST {action:'complete', job_id, failed}
const ACTIVE_STATUSES = ['queued', 'running', 'paused', 'stopped'];

async function handleSyncJob(req: Req, res: Res, supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('sync_jobs')
      .select('*')
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ job: data ?? null });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = body.action as string | undefined;

  if (action === 'start') {
    // Refuse if there's already an active job.
    const { data: existing } = await supabase
      .from('sync_jobs')
      .select('id, status')
      .in('status', ACTIVE_STATUSES)
      .limit(1)
      .maybeSingle();
    if (existing) {
      res.status(409).json({ error: 'Активне завдання вже існує', job_id: existing.id });
      return;
    }
    const location = (body.location as string | undefined) ?? null;
    const onlyUnsynced = body.only_unsynced !== false;
    const scope = (body.scope as string | undefined) ?? 'location';
    const medicsList = Array.isArray(body.medics_id_list) ? (body.medics_id_list as string[]) : null;

    // Build queue
    let queue: Array<{ medics_id: string; surname: string; location_id: string | null }> = [];
    if (scope === 'subset' && medicsList && medicsList.length > 0) {
      const { data, error } = await supabase
        .from('patients')
        .select('medics_id,surname,location_id')
        .in('medics_id', medicsList)
        .eq('archived', false)
        .not('medics_id', 'is', null);
      if (error) { res.status(500).json({ error: error.message }); return; }
      queue = (data ?? []) as typeof queue;
    } else {
      let q = supabase
        .from('patients')
        .select('medics_id,surname,location_id')
        .eq('archived', false)
        .not('medics_id', 'is', null);
      if (location) q = q.eq('location_id', location);
      if (onlyUnsynced) q = q.is('diagnoses_synced_at', null);
      q = q.order('surname', { ascending: true }).range(0, 9999);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      queue = (data ?? []) as typeof queue;
    }

    const { data: created, error: insErr } = await supabase
      .from('sync_jobs')
      .insert({
        location,
        only_unsynced: onlyUnsynced,
        scope,
        medics_id_list: medicsList,
        queue,
        cursor: 0,
        failed: [],
        status: 'queued',
        started_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      })
      .select('*')
      .maybeSingle();
    if (insErr || !created) {
      res.status(500).json({ error: insErr?.message ?? 'insert failed' });
      return;
    }
    res.status(201).json({ job: created });
    return;
  }

  const jobId = body.job_id as string | undefined;
  if (!jobId) {
    res.status(400).json({ error: 'job_id required' });
    return;
  }

  if (action === 'heartbeat') {
    const patch: Record<string, unknown> = {
      last_heartbeat_at: new Date().toISOString(),
      status: 'running',
    };
    if (typeof body.cursor === 'number') patch.cursor = body.cursor;
    if (Array.isArray(body.failed)) patch.failed = body.failed;
    if (typeof body.current_medics_id === 'string' || body.current_medics_id === null)
      patch.current_medics_id = body.current_medics_id;
    const { data, error } = await supabase
      .from('sync_jobs').update(patch).eq('id', jobId).select('*').maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ job: data });
    return;
  }

  if (action === 'stop') {
    const { data, error } = await supabase
      .from('sync_jobs')
      .update({ status: 'stopped', stopped_at: new Date().toISOString() })
      .eq('id', jobId)
      .select('*')
      .maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ job: data });
    return;
  }

  if (action === 'resume') {
    const { data: cur, error: curErr } = await supabase
      .from('sync_jobs').select('*').eq('id', jobId).maybeSingle();
    if (curErr || !cur) { res.status(404).json({ error: 'job not found' }); return; }

    const beat = cur.last_heartbeat_at ? new Date(cur.last_heartbeat_at as string).getTime() : 0;
    const ageMs = Date.now() - beat;
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
    const patch: Record<string, unknown> = {
      status: 'running',
      stopped_at: null,
      last_heartbeat_at: new Date().toISOString(),
    };
    if (ageMs > TWENTY_FOUR_H) {
      // Rebuild queue from scratch — patient set may have shifted.
      const scope = cur.scope as string;
      const location = cur.location as string | null;
      const onlyUnsynced = cur.only_unsynced as boolean;
      const medicsList = (cur.medics_id_list as string[] | null) ?? null;
      let queue: Array<{ medics_id: string; surname: string; location_id: string | null }> = [];
      if (scope === 'subset' && medicsList && medicsList.length > 0) {
        const { data } = await supabase
          .from('patients')
          .select('medics_id,surname,location_id')
          .in('medics_id', medicsList)
          .eq('archived', false)
          .not('medics_id', 'is', null);
        queue = (data ?? []) as typeof queue;
      } else {
        let q = supabase
          .from('patients')
          .select('medics_id,surname,location_id')
          .eq('archived', false)
          .not('medics_id', 'is', null);
        if (location) q = q.eq('location_id', location);
        if (onlyUnsynced) q = q.is('diagnoses_synced_at', null);
        q = q.order('surname', { ascending: true }).range(0, 9999);
        const { data } = await q;
        queue = (data ?? []) as typeof queue;
      }
      patch.queue = queue;
      patch.cursor = 0;
      patch.failed = [];
      patch.started_at = new Date().toISOString();
    }
    const { data, error } = await supabase
      .from('sync_jobs').update(patch).eq('id', jobId).select('*').maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ job: data, reset: ageMs > TWENTY_FOUR_H });
    return;
  }

  if (action === 'complete') {
    const patch: Record<string, unknown> = {
      status: 'done',
      finished_at: new Date().toISOString(),
      current_medics_id: null,
    };
    if (Array.isArray(body.failed)) patch.failed = body.failed;
    if (typeof body.cursor === 'number') patch.cursor = body.cursor;
    const { data, error } = await supabase
      .from('sync_jobs').update(patch).eq('id', jobId).select('*').maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ job: data });
    return;
  }

  if (action === 'cancel') {
    // Hard-discard: terminal state, frees the slot so a new job can start.
    // Lets the doctor abandon e.g. an unfinished Залужжя and immediately
    // queue Білогір'я.
    const { data, error } = await supabase
      .from('sync_jobs')
      .update({
        status: 'cancelled',
        finished_at: new Date().toISOString(),
        current_medics_id: null,
      })
      .eq('id', jobId)
      .select('*')
      .maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ job: data });
    return;
  }

  res.status(400).json({ error: `Unknown action: ${action}` });
}
