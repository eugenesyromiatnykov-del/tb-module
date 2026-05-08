import { verifySessionFromHeader } from './jwt.js';

type ReqLike = { headers: Record<string, string | string[] | undefined> };
type ResLike = {
  status: (code: number) => ResLike;
  json: (data: unknown) => void;
};

export async function requireAuth(req: ReqLike, res: ResLike): Promise<boolean> {
  const cookieHeader = req.headers.cookie;
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader ?? null;
  const session = await verifySessionFromHeader(header);
  if (!session) {
    res.status(401).json({ error: 'Не авторизовано' });
    return false;
  }
  return true;
}
