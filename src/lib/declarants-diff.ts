import type { DeclarantsDiff, IncomingPatient, PatientForDiff } from '@/types/database';

const COMPARE_FIELDS = [
  'surname',
  'first_name',
  'patronymic',
  'birth_date',
  'gender',
  'phone',
  'address',
  'location_id',
] as const;

function normName(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[ʼ'`’]/g, "'").replace(/\s+/g, ' ').trim();
}

function nameDobKey(p: { surname: string | null; first_name: string | null; patronymic: string | null; birth_date: string }): string {
  return `${normName(p.surname)}|${normName(p.first_name)}|${normName(p.patronymic)}|${p.birth_date}`;
}

export function computeDiff(
  incoming: IncomingPatient[],
  existing: PatientForDiff[],
  locationId: string,
): DeclarantsDiff {
  const byMedics = new Map<string, PatientForDiff>();
  const byNameDob = new Map<string, PatientForDiff>();
  for (const e of existing) {
    if (e.medics_id) byMedics.set(e.medics_id, e);
    const k = nameDobKey(e);
    // Prefer non-archived match; otherwise first-seen.
    const prev = byNameDob.get(k);
    if (!prev || (prev.archived && !e.archived)) byNameDob.set(k, e);
  }

  const add: IncomingPatient[] = [];
  const update: { id: string; patch: Partial<IncomingPatient> }[] = [];
  const archive: DeclarantsDiff['archive'] = [];
  let unchanged = 0;
  // Existing patients (by id) already covered by some incoming row.
  // Used both to avoid double-claim and to compute the archive set.
  const claimedIds = new Set<string>();

  for (const row of incoming) {
    let cur: PatientForDiff | null = byMedics.get(row.medics_id) ?? null;
    let medicsIdChanged = false;

    if (!cur || claimedIds.has(cur.id)) {
      // Fall back to ПІБ + ДН match. Two scenarios this catches:
      //   1. medics_id stayed the same but byMedics missed (stale fetch,
      //      whitespace, etc.) — we'd otherwise have generated a bogus add
      //      that crashes the INSERT on unique constraint.
      //   2. medics_id actually changed in МІС — file wins, generate update
      //      that rewrites medics_id along with whatever else differs.
      // Same key collision is handled by claimedIds so two file rows can't
      // both claim the same DB row.
      const byNd = byNameDob.get(nameDobKey(row));
      if (byNd && !claimedIds.has(byNd.id)) {
        cur = byNd;
        if (byNd.medics_id !== row.medics_id) {
          medicsIdChanged = true;
        }
      } else if (cur && claimedIds.has(cur.id)) {
        cur = null;
      }
    }

    if (!cur) {
      add.push(row);
      continue;
    }
    claimedIds.add(cur.id);

    if (cur.archived) {
      // Resurrect: clear archived + apply current row.
      const patch: Partial<IncomingPatient> = { ...row };
      update.push({ id: cur.id, patch });
      continue;
    }
    const patch: Partial<IncomingPatient> = {};
    for (const f of COMPARE_FIELDS) {
      const a = (cur as unknown as Record<string, unknown>)[f] ?? null;
      const b = (row as unknown as Record<string, unknown>)[f] ?? null;
      if (!equal(a, b)) (patch as Record<string, unknown>)[f] = b;
    }
    if (medicsIdChanged) (patch as Partial<IncomingPatient>).medics_id = row.medics_id;
    if (Object.keys(patch).length === 0) unchanged += 1;
    else update.push({ id: cur.id, patch });
  }

  // Archive: rows in DB at THIS location, active, not claimed by any incoming.
  for (const e of existing) {
    if (e.archived) continue;
    if (e.location_id !== locationId) continue;
    if (!e.medics_id) continue;
    if (claimedIds.has(e.id)) continue;
    archive.push({
      id: e.id,
      medics_id: e.medics_id,
      surname: e.surname,
      first_name: e.first_name,
    });
  }

  return { add, update, archive, unchanged, totalInFile: incoming.length };
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}
