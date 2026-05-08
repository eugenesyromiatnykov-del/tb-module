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

type Body = {
  // patient.id (already resolved on the client via fullName+birth match) → groups to add
  updates: { id: string; add_social: string[]; add_fluoro?: { date: string; result_code: string; result: string | null; next_planned_date: string | null }[] }[];
};

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<Body>;
  if (!Array.isArray(body.updates)) {
    res.status(400).json({ error: 'updates[] required' });
    return;
  }

  const supabase = getSupabaseAdmin();
  let patientsUpdated = 0;
  let fluoroAdded = 0;

  // Read all current social_risk_groups in one go for the affected patients.
  const ids = body.updates.map((u) => u.id);
  const currentMap = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, social_risk_groups')
      .in('id', ids);
    if (error) {
      res.status(500).json({ error: `lookup: ${error.message}` });
      return;
    }
    for (const p of data ?? []) {
      currentMap.set(p.id as string, (p.social_risk_groups ?? []) as string[]);
    }
  }

  const fluoroInserts: Record<string, unknown>[] = [];

  for (const u of body.updates) {
    const cur = currentMap.get(u.id) ?? [];
    const merged = Array.from(new Set([...cur, ...u.add_social]));
    if (merged.length !== cur.length || merged.some((m, i) => m !== cur[i])) {
      const { error } = await supabase
        .from('patients')
        .update({ social_risk_groups: merged })
        .eq('id', u.id);
      if (error) {
        res.status(500).json({ error: `update ${u.id}: ${error.message}` });
        return;
      }
      patientsUpdated += 1;
    }

    for (const f of u.add_fluoro ?? []) {
      fluoroInserts.push({
        patient_id: u.id,
        date: f.date,
        result: f.result,
        result_code: f.result_code,
        next_planned_date: f.next_planned_date,
        source: 'imported_xlsx',
      });
    }
  }

  for (const chunk of chunked(fluoroInserts, 500)) {
    const { error, count } = await supabase
      .from('fluorography')
      .insert(chunk, { count: 'exact' });
    if (error) {
      res.status(500).json({ error: `fluoro insert: ${error.message}` });
      return;
    }
    fluoroAdded += count ?? chunk.length;
  }

  res.status(200).json({ patientsUpdated, fluoroAdded });
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
