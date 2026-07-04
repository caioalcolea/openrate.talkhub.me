'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../../lib/auth';

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [loading, me, router]);

  if (loading) return <div className="p-6 text-neutral-500">Carregando…</div>;
  if (!me) return null;

  const isSuper = me.role === 'super_admin';
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <nav className="flex gap-4 text-sm">
          <Link href="/dashboard" className="font-semibold text-brand">OpenRate</Link>
          <Link href="/products">Produtos</Link>
          <Link href="/videos">Vídeos</Link>
          <Link href="/sales">Vendas</Link>
          <Link href="/commissions">Comissões</Link>
          <Link href="/payouts">Pagamentos</Link>
          <Link href="/goals">Metas</Link>
          {isSuper && <Link href="/orgs">Organizações</Link>}
        </nav>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <span>{me.user.full_name ?? me.user.email} · {me.role}</span>
          <button className="text-red-600" onClick={logout}>Sair</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
