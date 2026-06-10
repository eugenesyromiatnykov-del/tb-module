import bcrypt from 'bcryptjs';
import { verifySessionFromHeader } from './jwt.js';
import { getSupabaseAdmin } from './supabase-server.js';

type ReqLike = { headers: Record<string, string | string[] | undefined> };
type ResLike = {
  status: (code: number) => ResLike;
  json: (data: unknown) => void;
};

export type Session = {
  doctor_id: string;
  doctor_name: string;
};

// Accept either:
//   1. Cookie session JWT (web app, set by /api/auth/login) — carries
//      doctor_id + doctor_name as claims since v0019 multi-tenant.
//   2. Bearer <PIN> header (Chrome extension — content script + service
//      worker) — bcrypt-matched against all active doctors to resolve
//      which tenant this PIN belongs to.
//
// Returns the matched session on success; sends 401 and returns null on
// failure. Handlers should always `return` immediately on null. The
// session must be threaded into every Supabase query so the doctor only
// sees / writes their own tenant rows; that's the multi-tenant
// invariant we paid for the migration to enforce.
export async function requireAuth(req: ReqLike, res: ResLike): Promise<Session | null> {
  // 1. Cookie path
  const cookieHeader = req.headers.cookie;
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader ?? null;
  const payload = await verifySessionFromHeader(header);
  if (payload && typeof payload.doctor_id === 'string') {
    return {
      doctor_id: payload.doctor_id,
      doctor_name: typeof payload.doctor_name === 'string' ? payload.doctor_name : 'Doctor',
    };
  }

  // 2. Bearer PIN path (extension)
  const rawAuth = req.headers.authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const pin = auth.slice('Bearer '.length).trim();
    if (/^\d{4,12}$/.test(pin)) {
      // Multi-doctor: try every active doctor's PIN_HASH. For 2-5 doctors
      // each bcrypt.compare is ~30ms; total <200ms — within extension's
      // tolerance for a request that happens once per ~4s poll.
      try {
        const supabase = getSupabaseAdmin();
        const { data: doctors } = await supabase
          .from('doctors')
          .select('id, name, pin_hash')
          .eq('active', true);
        for (const d of doctors ?? []) {
          if (await bcrypt.compare(pin, d.pin_hash)) {
            return { doctor_id: d.id, doctor_name: d.name };
          }
        }
      } catch { /* DB error → drop through to 401 */ }
    }
  }

  res.status(401).json({ error: 'Не авторизовано' });
  return null;
}
