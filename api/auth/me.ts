import { issueSupabaseRealtimeToken, verifySessionFromHeader } from '../_lib/jwt.js';
import { getSupabaseAdmin } from '../_lib/supabase-server.js';

type VercelRequest = {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cookieHeader = req.headers.cookie;
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader ?? null;
  const session = await verifySessionFromHeader(header);
  if (!session) {
    res.status(401).json({ ok: false });
    return;
  }

  // Optional: mint a Supabase JWT for Realtime subscriptions. Frontend asks
  // for this via ?supabase=1 once the cookie is established.
  const wantSupabase = (Array.isArray(req.query?.supabase) ? req.query?.supabase[0] : req.query?.supabase) === '1';
  const doctorId = typeof session.doctor_id === 'string' ? session.doctor_id : null;

  // Pull the per-doctor permission flag so the UI can disable the sync
  // start button (kept server-authoritative — UI hint, not the gate).
  let canRunSync = false;
  if (doctorId) {
    const { data } = await getSupabaseAdmin()
      .from('doctors')
      .select('can_run_sync')
      .eq('id', doctorId)
      .maybeSingle();
    canRunSync = data?.can_run_sync === true;
  }

  const doctor = {
    id: doctorId,
    name: typeof session.doctor_name === 'string' ? session.doctor_name : null,
    can_run_sync: canRunSync,
  };

  if (wantSupabase) {
    try {
      const { token, expiresIn } = await issueSupabaseRealtimeToken();
      res.status(200).json({ ok: true, doctor, supabase: { token, expires_in: expiresIn } });
      return;
    } catch (e) {
      // SUPABASE_JWT_SECRET missing — degrade gracefully, just no realtime.
      res.status(200).json({ ok: true, doctor, supabase: null, error: (e as Error).message });
      return;
    }
  }

  res.status(200).json({ ok: true, doctor });
}
