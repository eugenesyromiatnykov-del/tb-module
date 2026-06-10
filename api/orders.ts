import { getSupabaseAdmin } from './_lib/supabase-server.js';
import { requireAuth } from './_lib/auth-guard.js';

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

const ALLOWED_FIELDS = new Set(['title', 'url', 'notes', 'category']);

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

// Накази (MOZ orders) are NOT per-doctor — same regulations across the
// whole country. We require auth but don't filter by doctor_id.
export default async function handler(req: Req, res: Res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  const supabase = getSupabaseAdmin();
  const q = req.query ?? {};

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('title', { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ orders: data ?? [] });
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as { title?: string; url?: string; notes?: string | null; category?: string | null };
    const title = (body.title ?? '').trim();
    const url = normalizeUrl(body.url ?? '');
    if (!title || !url) {
      res.status(400).json({ error: 'title and url required' });
      return;
    }
    const { data, error } = await supabase
      .from('orders')
      .insert({ title, url, notes: body.notes ?? null, category: body.category ?? null })
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ order: data });
    return;
  }

  const id = asString(q.id);
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      if (k === 'url' && typeof v === 'string') patch[k] = normalizeUrl(v);
      else if (k === 'title' && typeof v === 'string') patch[k] = v.trim();
      else patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    const { data, error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ order: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
