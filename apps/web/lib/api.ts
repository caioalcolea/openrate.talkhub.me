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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Um único refresh em voo por vez — evita corrida entre requests paralelas
// (que, com rotação de refresh token, invalidaria a sessão).
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY);
      if (!refresh) return false;
      try {
        const res = await fetch(`${BASE}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { access_token?: string; refresh_token?: string };
        if (!data.access_token) return false;
        setTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    clearTokens();
    window.location.assign('/login');
  }
}

// Extrai a mensagem amigável do erro do Nest ({ message } string ou string[]).
function humanError(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    const m = Array.isArray(j.message) ? j.message.join(', ') : j.message;
    if (m) return m;
  } catch {
    /* corpo não-JSON */
  }
  return text ? text.slice(0, 200) : `Erro ${status}`;
}

// Requisição crua com Bearer + 1 refresh em 401 (compartilhada por api() e pelos
// helpers de download). Retorna a Response; quem chama decide como ler o corpo.
async function rawRequest(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<Response> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    if (!opts.retry && (await tryRefresh())) return rawRequest(path, { ...opts, retry: true });
    redirectToLogin();
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
  }
  return res;
}

// Cliente HTTP tipado. Anexa o Bearer, faz 1 refresh em 401 e, se falhar,
// limpa a sessão e manda pro /login. Lança ApiError com mensagem amigável.
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const res = await rawRequest(path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, humanError(res.status, text));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Baixa uma resposta com corpo binário/texto (ex.: CSV) respeitando o Bearer:
// um <a href> não enviaria o header. Cria um blob e dispara o download.
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await rawRequest(path);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, humanError(res.status, text));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Endpoints que retornam { url } presignado (S3). A URL já é assinada — abre
// direto numa nova aba, sem precisar do Bearer.
export async function openSignedUrl(path: string): Promise<void> {
  const { url } = await api<{ url: string }>(path);
  window.open(url, '_blank', 'noopener');
}

// Act-as-org: troca o contexto de organização (re-emite o JWT com o org_id).
export async function switchOrg(orgId: string): Promise<void> {
  const data = await api<{ access_token: string; refresh_token: string }>('/v1/auth/switch-org', {
    method: 'POST',
    body: { orgId },
  });
  setTokens(data.access_token, data.refresh_token);
}

export const API_BASE = BASE;
