import { verifySessionFromHeader } from '../_lib/jwt.js';

type VercelRequest = { headers: Record<string, string | string[] | undefined> };
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
  res.status(200).json({ ok: true });
}
