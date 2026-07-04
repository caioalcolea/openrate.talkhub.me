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
          {me.org ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{me.org.name}</span>
          ) : isSuper ? (
            <Link href="/orgs" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              selecione uma organização
            </Link>
          ) : null}
          <span>{me.user.full_name ?? me.user.email} · {me.role}</span>
          <button className="text-red-600" onClick={logout}>Sair</button>
        </div>
      </header>
      {isSuper && !me.org && (
        <div className="border-b bg-amber-50 px-6 py-2 text-sm text-amber-800">
          Você é super_admin e ainda não entrou em nenhuma organização. Vá em{' '}
          <Link href="/orgs" className="font-semibold underline">Organizações</Link> para criar/entrar
          numa org antes de cadastrar lojas, produtos e metas.
        </div>
      )}
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
