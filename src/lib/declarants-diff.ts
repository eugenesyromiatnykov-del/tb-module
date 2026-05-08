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

export function computeDiff(
  incoming: IncomingPatient[],
  existing: PatientForDiff[],
  locationId: string,
): DeclarantsDiff {
  const byMedics = new Map<string, PatientForDiff>();
  for (const e of existing) {
    if (e.medics_id) byMedics.set(e.medics_id, e);
  }
  const incomingIds = new Set(incoming.map((r) => r.medics_id));

  const add: IncomingPatient[] = [];
  const update: { id: string; patch: Partial<IncomingPatient> }[] = [];
  const archive: DeclarantsDiff['archive'] = [];
  let unchanged = 0;

  for (const row of incoming) {
    const cur = byMedics.get(row.medics_id);
    if (!cur) {
      add.push(row);
      continue;
    }
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
    if (Object.keys(patch).length === 0) unchanged += 1;
    else update.push({ id: cur.id, patch });
  }

  // Anyone in DB at THIS location, not archived, not in incoming → archive.
  for (const e of existing) {
    if (e.archived) continue;
    if (e.location_id !== locationId) continue;
    if (!e.medics_id) continue;
    if (incomingIds.has(e.medics_id)) continue;
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
