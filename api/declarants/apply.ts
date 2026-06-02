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

export const config = { runtime: 'nodejs', maxDuration: 60 };

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

  // 1) Resolve incoming rows into INSERT (truly new) vs PROMOTE (already
  // exists as a no-medics_id "external"/"contact"/"detected" with same
  // surname+first+birth → assign medics_id, switch to risk, update fields).
  let added = 0;
  let promoted = 0;
  const insertConflicts: Array<{ medics_id: string; surname: string; first_name: string; reason: string }> = [];
  if (body.add.length > 0) {
    // Pull all non-declarant patients (medics_id IS NULL) so we can match by ПІБ+ДН.
    const { data: candidates, error: candErr } = await supabase
      .from('patients')
      .select('id, surname, first_name, patronymic, birth_date')
      .is('medics_id', null);
    if (candErr) {
      res.status(500).json({ error: `lookup external: ${candErr.message}` });
      return;
    }
    const norm = (s: string | null | undefined) =>
      (s ?? '').toString().toLowerCase().replace(/[ʼ'`]/g, "'").trim();
    const byKey = new Map<string, string>(); // key → patient.id
    for (const c of candidates ?? []) {
      const k = `${norm(c.surname)}|${norm(c.first_name)}|${c.birth_date}`;
      if (!byKey.has(k)) byKey.set(k, c.id as string);
    }

    const trulyNew: typeof body.add = [];
    const toPromote: { id: string; row: typeof body.add[number] }[] = [];
    for (const p of body.add) {
      const k = `${norm(p.surname)}|${norm(p.first_name)}|${p.birth_date}`;
      const existingId = byKey.get(k);
      if (existingId) toPromote.push({ id: existingId, row: p });
      else trulyNew.push(p);
    }

    // INSERT truly new. Chunked optimistic path first; on conflict we drop
    // to per-row inserts and surface the bad rows in a warning list so the
    // doctor can see which medics_id collided instead of failing the run.
    if (trulyNew.length > 0) {
      const rows = trulyNew.map((p) => ({
        ...p,
        tb_status: 'risk' as const,
        medical_risk_groups: [],
        social_risk_groups: [],
        diagnoses_codes: [],
      }));
      for (const chunk of chunked(rows, 500)) {
        const { error, count } = await supabase.from('patients').insert(chunk, { count: 'exact' });
        if (!error) {
          added += count ?? chunk.length;
          continue;
        }
        // Fall back to per-row to keep the rest of the chunk going.
        // Parallelised so a 500-row chunk doesn't take a minute.
        console.warn('[declarants apply] chunked insert failed, retrying per-row:', error.message);
        const INSERT_CONCURRENCY = 25;
        for (let i = 0; i < chunk.length; i += INSERT_CONCURRENCY) {
          const sub = chunk.slice(i, i + INSERT_CONCURRENCY);
          const results = await Promise.all(
            sub.map(async (row) => {
              const { error: e2 } = await supabase.from('patients').insert(row);
              return { row, error: e2 };
            }),
          );
          for (const r of results) {
            if (!r.error) { added += 1; continue; }
            insertConflicts.push({
              medics_id: r.row.medics_id,
              surname: r.row.surname,
              first_name: r.row.first_name,
              reason: r.error.message,
            });
          }
        }
      }
    }

    // PROMOTE: keep social_risk_groups, fluoro/sputum (already linked), but assign
    // medics_id, set tb_status='risk' (or keep detected/contact if it was), and
    // overwrite identity fields from the xlsx. Parallelised in chunks for speed.
    const PROMOTE_CONCURRENCY = 25;
    if (toPromote.length > 0) {
      const ids = toPromote.map((p) => p.id);
      const { data: curRows } = await supabase
        .from('patients').select('id, tb_status').in('id', ids);
      const statusById = new Map<string, string>();
      for (const r of curRows ?? []) statusById.set(r.id as string, r.tb_status as string);
      for (let i = 0; i < toPromote.length; i += PROMOTE_CONCURRENCY) {
        const slice = toPromote.slice(i, i + PROMOTE_CONCURRENCY);
        const results = await Promise.all(
          slice.map(async ({ id, row }) => {
            const curStatus = statusById.get(id);
            const finalStatus =
              curStatus === 'detected' || curStatus === 'contact' ? curStatus : 'risk';
            const { error } = await supabase
              .from('patients')
              .update({
                medics_id: row.medics_id,
                surname: row.surname,
                first_name: row.first_name,
                patronymic: row.patronymic,
                birth_date: row.birth_date,
                gender: row.gender,
                phone: row.phone,
                address: row.address,
                location_id: row.location_id,
                tb_status: finalStatus,
              })
              .eq('id', id);
            return { id, error };
          }),
        );
        for (const r of results) {
          if (r.error) {
            insertConflicts.push({
              medics_id: '',
              surname: '',
              first_name: '',
              reason: `promote ${r.id}: ${r.error.message}`,
            });
          } else {
            promoted += 1;
          }
        }
      }
    }
  }

  // 2) UPDATE per-row (only changed fields per patient).
  // Each patch is different so we can't do one bulk UPDATE — but we CAN
  // fire them in parallel chunks. Sequentially this was ~100ms × 1200+
  // rows ≈ 2 minutes (and risks hitting Vercel's serverless timeout).
  // 25-concurrent ≈ 50 round-trips × 100ms ≈ 5 s.
  let updated = 0;
  const updateFailures: Array<{ id: string; medics_id?: string; reason: string }> = [];
  const UPDATE_CONCURRENCY = 25;
  for (let i = 0; i < body.update.length; i += UPDATE_CONCURRENCY) {
    const slice = body.update.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (u) => {
        if (!u.id) return { ok: true, u, error: null as null | { message: string } };
        const { error } = await supabase.from('patients').update(u.patch).eq('id', u.id);
        return { ok: !error, u, error };
      }),
    );
    for (const r of results) {
      if (r.ok) {
        updated += 1;
      } else {
        updateFailures.push({
          id: r.u.id,
          medics_id: r.u.patch.medics_id ?? undefined,
          reason: r.error?.message ?? 'unknown',
        });
      }
    }
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
    patients_updated: updated + promoted,
    patients_archived: archived,
    diff_summary: {
      locationId: body.locationId,
      add: body.add.length,
      update: body.update.length,
      archive: body.archive.length,
      promoted,
    },
  });

  res.status(200).json({
    added,
    updated,
    archived,
    promoted,
    failures: {
      insert: insertConflicts,
      update: updateFailures,
    },
  });
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
