// Tiny in-memory rate limiter as a fallback when Upstash is not configured.
// On Vercel, Edge/serverless instances are short-lived, so this protects
// against trivial scripted attacks but is NOT a substitute for Upstash KV
// in production. When UPSTASH_REDIS_REST_URL is set, this falls back to it.

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Bucket = { count: number; firstAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export async function checkAndRecordFailure(ip: string): Promise<RateLimitResult> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return upstashCheck(ip, /*increment*/ false);
  }
  return localCheck(ip);
}

export async function recordFailure(ip: string): Promise<void> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    await upstashCheck(ip, /*increment*/ true);
    return;
  }
  const now = Date.now();
  const cur = buckets.get(ip);
  if (!cur || now - cur.firstAt > WINDOW_MS) {
    buckets.set(ip, { count: 1, firstAt: now });
  } else {
    cur.count += 1;
  }
}

export async function clearFailures(ip: string): Promise<void> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    await upstashClear(ip);
    return;
  }
  buckets.delete(ip);
}

function localCheck(ip: string): RateLimitResult {
  const now = Date.now();
  const cur = buckets.get(ip);
  if (!cur) return { ok: true };
  if (now - cur.firstAt > WINDOW_MS) {
    buckets.delete(ip);
    return { ok: true };
  }
  if (cur.count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - cur.firstAt)) / 1000) };
  }
  return { ok: true };
}

async function upstashCheck(ip: string, increment: boolean): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const key = `tb:rl:${ip}`;
  const ttlSec = Math.ceil(WINDOW_MS / 1000);

  if (increment) {
    await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await fetch(`${url}/expire/${encodeURIComponent(key)}/${ttlSec}/NX`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as { result?: string | null } | null;
  const count = body?.result ? Number(body.result) : 0;
  if (count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSeconds: ttlSec };
  }
  return { ok: true };
}

async function upstashClear(ip: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const key = `tb:rl:${ip}`;
  await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}
