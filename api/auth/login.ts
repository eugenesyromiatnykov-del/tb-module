import bcrypt from 'bcryptjs';
import { issueSessionCookie } from '../_lib/jwt.js';
import { checkAndRecordFailure, clearFailures, recordFailure } from '../_lib/rate-limit.js';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (key: string, value: string | string[]) => void;
  json: (data: unknown) => void;
  end: () => void;
};

export const config = { runtime: 'nodejs' };

function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff[0]) return xff[0].split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip = clientIp(req);
  const gate = await checkAndRecordFailure(ip);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfterSeconds));
    res.status(429).json({
      error: `Забагато спроб. Спробуйте через ${Math.ceil(gate.retryAfterSeconds / 60)} хв.`,
    });
    return;
  }

  const body = (req.body ?? {}) as { pin?: unknown };
  const raw = typeof body.pin === 'string' ? body.pin : '';
  const pin = raw.trim();

  if (!/^\d{4,12}$/.test(pin)) {
    await recordFailure(ip);
    res.status(400).json({ error: 'Невірний формат PIN' });
    return;
  }

  // Multi-doctor PIN match: try bcrypt.compare against every active doctor.
  // bcrypt is intentionally slow (~30ms each); for 2-5 doctors this is
  // imperceptible. If we ever exceed ~20 doctors we'd want a faster
  // lookup scheme (e.g. a separate fast-hash index keyed by PIN_PREFIX).
  const { getSupabaseAdmin } = await import('../_lib/supabase-server.js');
  const supabase = getSupabaseAdmin();
  const { data: doctors, error } = await supabase
    .from('doctors')
    .select('id, name, pin_hash')
    .eq('active', true);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  let matched: { id: string; name: string } | null = null;
  for (const d of doctors ?? []) {
    if (await bcrypt.compare(pin, d.pin_hash)) {
      matched = { id: d.id, name: d.name };
      break;
    }
  }
  if (!matched) {
    await recordFailure(ip);
    res.status(401).json({ error: 'Невірний PIN' });
    return;
  }

  await clearFailures(ip);
  const cookie = await issueSessionCookie({ doctor_id: matched.id, doctor_name: matched.name });
  res.setHeader('Set-Cookie', cookie);
  res.status(200).json({ ok: true, doctor: matched });
}
