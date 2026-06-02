import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from './_lib/supabase-server.js';

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

const ALLOWED_ORIGINS = [
  'https://medics.ua',
  'chrome-extension://*',
];

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function setCors(req: Req, res: Res) {
  const origin = req.headers.origin;
  const o = Array.isArray(origin) ? origin[0] : origin;
  // Permissive for chrome-extension://<id> and medics.ua.
  if (o && (o.startsWith('chrome-extension://') || ALLOWED_ORIGINS.some((a) => a === o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function authenticate(req: Req): Promise<boolean> {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || !header.startsWith('Bearer ')) return false;
  const pin = header.slice('Bearer '.length).trim();
  if (!/^\d{4,12}$/.test(pin)) return false;
  const hash = process.env.PIN_HASH;
  if (!hash) return false;
  return await bcrypt.compare(pin, hash);
}

export default async function handler(req: Req, res: Res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).json({});
    return;
  }

  if (!(await authenticate(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabase = getSupabaseAdmin();
  const q = req.query ?? {};

  // ── GET: fetch patient state by medics_id ──────────────────────────────
  if (req.method === 'GET') {
    const medics = asString(q.medics_id);
    if (!medics) {
      res.status(400).json({ error: 'medics_id required' });
      return;
    }
    const { data, error } = await supabase
      .from('patient_dashboard')
      .select(`
        id, medics_id, surname, first_name, patronymic, birth_date, gender,
        phone, address, location_id, tb_status, archived,
        medical_risk_groups, social_risk_groups,
        last_fluoro_date, next_planned_date, last_result_code,
        last_adpm_date, next_adpm_date,
        adpm_contraindication, adpm_refused,
        last_indicators_synced_at
      `)
      .eq('medics_id', medics)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(200).json({ found: false });
      return;
    }
    // Pull cached indicator results so the extension can render the prior
    // analysis instantly on med-card open (before/instead of re-running).
    const { data: indicators } = await supabase
      .from('indicator_results')
      .select(`
        rule_id, rule_name, rule_category, state, is_overdue,
        completed_count, total_count, last_date, next_date,
        frequency_months, required_actions, details, analyzed_at
      `)
      .eq('patient_id', data.id as string)
      .order('rule_id');
    res.status(200).json({ found: true, patient: data, indicators: indicators ?? [] });
    return;
  }

  // ── POST: upsert patient + optional fluoro record ──────────────────────
  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      medics_id?: string;
      surname?: string;
      first_name?: string;
      patronymic?: string | null;
      birth_date?: string;
      gender?: 'M' | 'F' | null;
      phone?: string | null;
      address?: string | null;
      location_id?: string | null;
      diagnoses_codes?: string[];
      diagnoses_detail?: Array<{ code: string; name?: string | null; date?: string | null }>;
      medical_risk_groups?: string[];
      social_risk_groups?: string[];
      fluoro?: {
        date: string;
        result?: string | null;
        result_code?: string;
        next_planned_date?: string | null;
      };
      adpm?: {
        date: string;
        vaccine_name?: string | null;
        manufacturer?: string | null;
        lot_number?: string | null;
        notes?: string | null;
      };
      // Full per-rule snapshot from indicator-matcher. Sending an array
      // (even empty) makes this client authoritative — the server replaces
      // the patient's entire indicator_results set. Sending undefined
      // leaves whatever was stored untouched.
      indicators?: Array<{
        rule_id: string;
        rule_name?: string | null;
        rule_category?: string | null;
        state: 'completed' | 'overdue' | 'partial' | 'not_done';
        is_overdue?: boolean;
        completed_count?: number;
        total_count?: number;
        last_date?: string | null;     // ISO 'YYYY-MM-DD'
        next_date?: string | null;
        frequency_months?: number | null;
        required_actions?: unknown[];
        details?: unknown[];
      }>;
    };

    if (!body.medics_id) {
      res.status(400).json({ error: 'medics_id required' });
      return;
    }

    // Look up existing patient.
    const { data: existing, error: lookupErr } = await supabase
      .from('patients')
      .select('id, medical_risk_groups, social_risk_groups, diagnoses_codes, tb_status')
      .eq('medics_id', body.medics_id)
      .maybeSingle();
    if (lookupErr) {
      res.status(500).json({ error: lookupErr.message });
      return;
    }

    let patientId: string;
    if (existing) {
      patientId = existing.id as string;
      const patch: Record<string, unknown> = {};
      if (body.surname) patch.surname = body.surname;
      if (body.first_name) patch.first_name = body.first_name;
      if (body.patronymic !== undefined) patch.patronymic = body.patronymic;
      if (body.birth_date) patch.birth_date = body.birth_date;
      if (body.gender !== undefined) patch.gender = body.gender;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.address !== undefined) patch.address = body.address;
      if (body.location_id !== undefined) patch.location_id = body.location_id;
      if (Array.isArray(body.diagnoses_codes)) {
        patch.diagnoses_codes = body.diagnoses_codes;
        patch.diagnoses_synced_at = new Date().toISOString();
      }
      if (Array.isArray(body.diagnoses_detail)) {
        // MIS is authoritative — replace, don't merge. Strip unknown keys.
        patch.diagnoses_detail = body.diagnoses_detail.map((d) => ({
          code: d.code,
          name: d.name ?? null,
          date: d.date ?? null,
        }));
      }
      if (Array.isArray(body.medical_risk_groups)) {
        // Merge (union) — extension is authoritative for medical groups it detects.
        const merged = Array.from(
          new Set([...(existing.medical_risk_groups ?? []), ...body.medical_risk_groups]),
        );
        patch.medical_risk_groups = merged;
      }
      if (Array.isArray(body.social_risk_groups) && body.social_risk_groups.length > 0) {
        // Union with existing — never remove a manually-set tag.
        const merged = Array.from(
          new Set([...(existing.social_risk_groups ?? []), ...body.social_risk_groups]),
        );
        patch.social_risk_groups = merged;
      }

      // Auto-demote / re-promote based on the post-merge risk-group state.
      // Only acts when the extension actually analyzed (sent medical_risk_groups
      // as an array, even if empty). Never touches 'detected' or 'archived'.
      if (Array.isArray(body.medical_risk_groups)) {
        const postMedical =
          (patch.medical_risk_groups as string[] | undefined) ?? existing.medical_risk_groups ?? [];
        const postSocial =
          (patch.social_risk_groups as string[] | undefined) ?? existing.social_risk_groups ?? [];
        const hasAnyRisk = postMedical.length > 0 || postSocial.length > 0;
        const cur = existing.tb_status as string | undefined;
        if (cur === 'risk' && !hasAnyRisk) {
          patch.tb_status = 'cleared';
        } else if (cur === 'cleared' && hasAnyRisk) {
          patch.tb_status = 'risk';
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('patients').update(patch).eq('id', patientId);
        if (error) {
          res.status(500).json({ error: `update: ${error.message}` });
          return;
        }
      }
    } else {
      // Create new patient.
      if (!body.surname || !body.first_name || !body.birth_date) {
        res.status(400).json({ error: 'surname, first_name, birth_date required for new patient' });
        return;
      }
      const insertRow = {
        medics_id: body.medics_id,
        surname: body.surname,
        first_name: body.first_name,
        patronymic: body.patronymic ?? null,
        birth_date: body.birth_date,
        gender: body.gender ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        location_id: body.location_id ?? null,
        tb_status: 'risk' as const,
        medical_risk_groups: body.medical_risk_groups ?? [],
        social_risk_groups: body.social_risk_groups ?? [],
        diagnoses_codes: body.diagnoses_codes ?? [],
        diagnoses_synced_at: body.diagnoses_codes ? new Date().toISOString() : null,
      };
      const { data: created, error: insertErr } = await supabase
        .from('patients')
        .insert(insertRow)
        .select('id')
        .maybeSingle();
      if (insertErr || !created) {
        res.status(500).json({ error: `insert: ${insertErr?.message ?? 'no row'}` });
        return;
      }
      patientId = created.id as string;
    }

    // Optional fluoro record.
    let fluoroAdded = false;
    if (body.fluoro && body.fluoro.date) {
      // Skip dupe (patient_id + date + result_code).
      const code = body.fluoro.result_code ?? 'unknown';
      const { data: dup } = await supabase
        .from('fluorography')
        .select('id')
        .eq('patient_id', patientId)
        .eq('date', body.fluoro.date)
        .eq('result_code', code)
        .maybeSingle();
      if (!dup) {
        const { error } = await supabase.from('fluorography').insert({
          patient_id: patientId,
          date: body.fluoro.date,
          result: body.fluoro.result ?? null,
          result_code: code,
          next_planned_date: body.fluoro.next_planned_date ?? null,
          source: 'extension',
        });
        if (error) {
          res.status(500).json({ error: `fluoro: ${error.message}` });
          return;
        }
        fluoroAdded = true;
      }
    }

    // Optional АДП-М record. Skip dupe on (patient_id + date).
    let adpmAdded = false;
    if (body.adpm && body.adpm.date) {
      const { data: dup } = await supabase
        .from('adpm_vaccinations')
        .select('id')
        .eq('patient_id', patientId)
        .eq('date', body.adpm.date)
        .maybeSingle();
      if (!dup) {
        const { error } = await supabase.from('adpm_vaccinations').insert({
          patient_id: patientId,
          date: body.adpm.date,
          vaccine_name: body.adpm.vaccine_name ?? null,
          manufacturer: body.adpm.manufacturer ?? null,
          lot_number: body.adpm.lot_number ?? null,
          notes: body.adpm.notes ?? null,
          source: 'extension',
        });
        if (error) {
          res.status(500).json({ error: `adpm: ${error.message}` });
          return;
        }
        adpmAdded = true;
      }
    }

    // ── Indicator results snapshot ──────────────────────────────────────
    // Replace-all semantics: extension is authoritative for what rules apply.
    // If the patient ages out of "preventive-exam-40-64" into "preventive-
    // exam-65-plus", the old row should disappear so reports don't show
    // a stale "applies but not_done" forever.
    let indicatorsSaved = 0;
    if (Array.isArray(body.indicators)) {
      const now = new Date().toISOString();
      // Wipe + bulk-insert is simpler and atomic enough — only one
      // extension runs per patient at a time.
      const { error: delErr } = await supabase
        .from('indicator_results')
        .delete()
        .eq('patient_id', patientId);
      if (delErr) {
        res.status(500).json({ error: `indicators clear: ${delErr.message}` });
        return;
      }
      if (body.indicators.length > 0) {
        const rows = body.indicators.map((ind) => ({
          patient_id: patientId,
          rule_id: ind.rule_id,
          rule_name: ind.rule_name ?? null,
          rule_category: ind.rule_category ?? null,
          state: ind.state,
          is_overdue: ind.is_overdue ?? (ind.state === 'overdue'),
          completed_count: ind.completed_count ?? 0,
          total_count: ind.total_count ?? 0,
          last_date: ind.last_date ?? null,
          next_date: ind.next_date ?? null,
          frequency_months: ind.frequency_months ?? null,
          required_actions: Array.isArray(ind.required_actions) ? ind.required_actions : [],
          details: Array.isArray(ind.details) ? ind.details : [],
          analyzed_at: now,
        }));
        const { error: insErr } = await supabase.from('indicator_results').insert(rows);
        if (insErr) {
          res.status(500).json({ error: `indicators insert: ${insErr.message}` });
          return;
        }
        indicatorsSaved = rows.length;
      }
      await supabase
        .from('patients')
        .update({ last_indicators_synced_at: now })
        .eq('id', patientId);
    }

    res.status(200).json({
      ok: true,
      patient_id: patientId,
      created: !existing,
      fluoroAdded,
      adpmAdded,
      indicatorsSaved,
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
