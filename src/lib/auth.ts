export type AuthState = 'unknown' | 'authed' | 'guest';

let cached: AuthState = 'unknown';

export async function checkAuth(): Promise<AuthState> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    cached = res.ok ? 'authed' : 'guest';
  } catch {
    cached = 'guest';
  }
  return cached;
}

export async function loginWithPin(pin: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pin }),
  });
  if (res.ok) {
    cached = 'authed';
    return { ok: true };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error ?? 'Помилка входу' };
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  cached = 'guest';
}

export function getCachedAuth() {
  return cached;
}
