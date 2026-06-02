// Shared CORS for endpoints called from the Chrome extension (service worker
// uses chrome-extension://<id> origin; content scripts use https://medics.ua).
// Web-app calls share-origin → CORS doesn't apply.

type ReqLike = { method?: string; headers: Record<string, string | string[] | undefined> };
type ResLike = {
  status: (code: number) => ResLike;
  setHeader: (key: string, value: string | string[]) => void;
  json: (data: unknown) => void;
};

const ALLOWED_STATIC = ['https://medics.ua'];

export function setCors(req: ReqLike, res: ResLike): void {
  const raw = req.headers.origin;
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (o && (o.startsWith('chrome-extension://') || ALLOWED_STATIC.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Handles OPTIONS preflight. Returns true if the request was a preflight
// and was answered; caller should `return` immediately.
export function handlePreflight(req: ReqLike, res: ResLike): boolean {
  if (req.method !== 'OPTIONS') return false;
  setCors(req, res);
  res.status(204).json({});
  return true;
}
