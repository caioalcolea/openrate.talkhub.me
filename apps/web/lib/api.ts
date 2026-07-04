'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const TOKEN_KEY = 'openrate.access_token';
const REFRESH_KEY = 'openrate.refresh_token';

export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}
export function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

async function tryRefresh(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const res = await fetch(`${BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (data.access_token) {
    setTokens(data.access_token, data.refresh_token);
    return true;
  }
  return false;
}

// Cliente HTTP tipado. Anexa o Bearer e tenta um refresh em 401.
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.retry && (await tryRefresh())) {
    return api<T>(path, { ...opts, retry: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const API_BASE = BASE;
