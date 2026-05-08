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

type IncomingPatient = {
  medics_id: string;
  surname: string;
  first_name: string;
  patronymic?: string | null;
  birth_date: string;
  gender?: 'M' | 'F' | null;
  phone?: string | null;
  address?: string | null;
  location_id: string;
};

type ApplyBody = {
  locationId: string;
  filename?: string;
  add: IncomingPatient[];
  update: { id: string; patch: Partial<IncomingPatient> }[];
  archive: { id: string }[];
  totalInFile: number;
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<ApplyBody>;
  if (!body.locationId || !Array.isArray(body.add) || !Array.isArray(body.update) || !Array.isArray(body.archive)) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const supabase = getSupabaseAdmin();

  // 1) INSERT new patients (chunked).
  let added = 0;
  if (body.add.length > 0) {
    const rows = body.add.map((p) => ({
      ...p,
      tb_status: 'risk' as const,
      medical_risk_groups: [],
      social_risk_groups: [],
      diagnoses_codes: [],
    }));
    for (const chunk of chunked(rows, 500)) {
      const { error, count } = await supabase.from('patients').insert(chunk, { count: 'exact' });
      if (error) {
        res.status(500).json({ error: `insert: ${error.message}` });
        return;
      }
      added += count ?? chunk.length;
    }
  }

  // 2) UPDATE per-row (only changed fields per patient).
  let updated = 0;
  for (const u of body.update) {
    if (!u.id) continue;
    const { error } = await supabase.from('patients').update(u.patch).eq('id', u.id);
    if (error) {
      res.status(500).json({ error: `update ${u.id}: ${error.message}` });
      return;
    }
    updated += 1;
  }

  // 3) ARCHIVE — set archived=true with reason='left_practice'.
  let archived = 0;
  if (body.archive.length > 0) {
    const ids = body.archive.map((a) => a.id).filter(Boolean);
    if (ids.length > 0) {
      const { error } = await supabase
        .from('patients')
        .update({ archived: true, archived_reason: 'left_practice', archived_at: new Date().toISOString() })
        .in('id', ids);
      if (error) {
        res.status(500).json({ error: `archive: ${error.message}` });
        return;
      }
      archived = ids.length;
    }
  }

  // 4) Record import in mis_imports.
  await supabase.from('mis_imports').insert({
    filename: body.filename ?? null,
    total_in_file: body.totalInFile ?? body.add.length + body.update.length,
    patients_added: added,
    patients_updated: updated,
    patients_archived: archived,
    diff_summary: {
      locationId: body.locationId,
      add: body.add.length,
      update: body.update.length,
      archive: body.archive.length,
    },
  });

  res.status(200).json({ added, updated, archived });
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
