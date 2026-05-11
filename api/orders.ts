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

const BUCKET = 'orders';

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function handler(req: Req, res: Res) {
  if (!(await requireAuth(req, res))) return;
  const supabase = getSupabaseAdmin();
  const q = req.query ?? {};
  const action = asString(q.action);

  if (req.method === 'GET') {
    // List all files in the bucket.
    if (!action || action === 'list') {
      const { data, error } = await supabase.storage.from(BUCKET).list('', {
        limit: 200,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      const items = (data ?? [])
        .filter((f) => f.name && !f.name.startsWith('.'))
        .map((f) => ({
          name: f.name,
          size: f.metadata?.size ?? null,
          mime_type: f.metadata?.mimetype ?? null,
          created_at: f.created_at,
          updated_at: f.updated_at,
        }));
      res.status(200).json({ orders: items });
      return;
    }

    // Get a short-lived signed download URL.
    if (action === 'download') {
      const path = asString(q.path);
      if (!path) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 5);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(200).json({ url: data.signedUrl });
      return;
    }

    res.status(400).json({ error: `Unknown GET action: ${action}` });
    return;
  }

  if (req.method === 'POST') {
    // Server-side upload via base64 payload. OK for files up to ~4 MB
    // (Vercel body limit). Bigger files would need signed upload URLs.
    const body = (req.body ?? {}) as { filename?: string; content_base64?: string; mime_type?: string };
    if (!body.filename || !body.content_base64) {
      res.status(400).json({ error: 'filename and content_base64 required' });
      return;
    }
    const buf = Buffer.from(body.content_base64, 'base64');
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(body.filename, buf, {
        contentType: body.mime_type ?? 'application/octet-stream',
        upsert: true,
      });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ ok: true, path: body.filename });
    return;
  }

  if (req.method === 'DELETE') {
    const path = asString(q.path);
    if (!path) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
