'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserRole } from '@openrate/shared';
import { api, setTokens, clearTokens, getToken, switchOrg as apiSwitchOrg } from './api';

interface Me {
  user: { id: string; email?: string; full_name?: string; role: UserRole };
  org: { id: string; name: string } | null;
  store: { id: string; name: string } | null;
  role: UserRole;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchOrg: (orgId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/v1/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  async function login(email: string, password: string) {
    const data = await api<{ access_token: string; refresh_token: string }>('/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setTokens(data.access_token, data.refresh_token);
    await loadMe();
  }

  function logout() {
    clearTokens();
    setMe(null);
  }

  async function switchOrg(orgId: string) {
    await apiSwitchOrg(orgId);
    await loadMe();
  }

  return (
    <AuthCtx.Provider value={{ me, loading, login, logout, switchOrg, reload: loadMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
