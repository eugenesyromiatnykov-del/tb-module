import bcrypt from 'bcryptjs';
import { verifySessionFromHeader } from './jwt.js';

type ReqLike = { headers: Record<string, string | string[] | undefined> };
type ResLike = {
  status: (code: number) => ResLike;
  json: (data: unknown) => void;
};

// Accept either:
//   1. Cookie session JWT (web app, set by /api/auth/login)
//   2. Bearer <PIN> header (Chrome extension — content script + service worker)
// Both paths gate behind the same secret (env PIN_HASH); the cookie path also
// requires JWT_SECRET to be present at issue time.
export async function requireAuth(req: ReqLike, res: ResLike): Promise<boolean> {
  const cookieHeader = req.headers.cookie;
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader ?? null;
  const session = await verifySessionFromHeader(header);
  if (session) return true;

  const rawAuth = req.headers.authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const pin = auth.slice('Bearer '.length).trim();
    if (/^\d{4,12}$/.test(pin) && process.env.PIN_HASH) {
      try {
        if (await bcrypt.compare(pin, process.env.PIN_HASH)) return true;
      } catch { /* ignore */ }
    }
  }

  res.status(401).json({ error: 'Не авторизовано' });
  return false;
}
