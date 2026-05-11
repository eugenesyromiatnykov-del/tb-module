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
        last_fluoro_date, next_planned_date, last_result_code
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
    res.status(200).json({ found: true, patient: data });
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
      medical_risk_groups?: string[];
      fluoro?: {
        date: string;
        result?: string | null;
        result_code?: string;
        next_planned_date?: string | null;
      };
    };

    if (!body.medics_id) {
      res.status(400).json({ error: 'medics_id required' });
      return;
    }

    // Look up existing patient.
    const { data: existing, error: lookupErr } = await supabase
      .from('patients')
      .select('id, medical_risk_groups, social_risk_groups, diagnoses_codes')
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
      if (Array.isArray(body.medical_risk_groups)) {
        // Merge (union) — extension is authoritative for medical groups it detects.
        const merged = Array.from(
          new Set([...(existing.medical_risk_groups ?? []), ...body.medical_risk_groups]),
        );
        patch.medical_risk_groups = merged;
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
        social_risk_groups: [],
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

    res.status(200).json({ ok: true, patient_id: patientId, created: !existing, fluoroAdded });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
