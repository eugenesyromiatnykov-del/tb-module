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

const ALLOWED_FIELDS = new Set(['date', 'result', 'result_code', 'next_planned_date', 'notes']);

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;

  const id = asString(req.query?.id);
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const supabase = getSupabaseAdmin();

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    const { data, error } = await supabase
      .from('fluorography')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ fluorography: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('fluorography').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
