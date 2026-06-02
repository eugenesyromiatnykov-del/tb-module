import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const COOKIE_NAME = 'tb_session';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(raw);
}

export async function issueSessionCookie(payload: JWTPayload = {}): Promise<string> {
  const token = await new SignJWT({ ...payload, role: 'practice' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());

  return [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${TTL_SECONDS}`,
  ].join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function verifySessionFromHeader(cookieHeader: string | null): Promise<JWTPayload | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = match.slice(COOKIE_NAME.length + 1);
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// Supabase Realtime needs a JWT signed with SUPABASE_JWT_SECRET, carrying
// `role: 'authenticated'` and `aud: 'authenticated'` — that's how the
// realtime gateway decides whose RLS policies apply. Mint a short-lived one
// for the current logged-in session so the frontend can subscribe to
// postgres_changes channels without ever holding the service_role key.
const SUPABASE_TTL_SECONDS = 60 * 60; // 1 hour — frontend refetches as needed

export async function issueSupabaseRealtimeToken(): Promise<{ token: string; expiresIn: number }> {
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw) throw new Error('SUPABASE_JWT_SECRET is not set');
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('authenticated')
    .setExpirationTime(`${SUPABASE_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(raw));
  return { token, expiresIn: SUPABASE_TTL_SECONDS };
}
