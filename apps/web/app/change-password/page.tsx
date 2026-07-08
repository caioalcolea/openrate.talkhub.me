'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, getToken } from '../../lib/api';
import type { UserRole } from '@openrate/shared';

interface Me {
  user: { must_change_password?: boolean };
  role: UserRole;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [needsCurrent, setNeedsCurrent] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<Me>('/v1/me')
      .then((me) => {
        setNeedsCurrent(!me.user.must_change_password);
        setRole(me.role);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('A nova senha precisa de pelo menos 8 caracteres.');
    if (next !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      await api('/v1/auth/change-password', {
        method: 'POST',
        body: { currentPassword: needsCurrent ? current : undefined, newPassword: next },
      });
      router.replace(role === 'attendant' ? '/app' : '/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-1 text-xl font-semibold">Trocar senha</h1>
      <p className="mb-4 text-sm text-neutral-500">
        {needsCurrent ? 'Defina uma nova senha.' : 'Primeiro acesso: defina uma senha nova para continuar.'}
      </p>
      {error && <div className="alert-error mb-3">{error}</div>}
      <form onSubmit={submit} className="card space-y-3">
        {needsCurrent && (
          <div>
            <label className="label">Senha atual</label>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
        )}
        <div>
          <label className="label">Nova senha</label>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="label">Confirmar nova senha</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        <button className="btn w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </div>
  );
}
