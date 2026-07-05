'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../../lib/auth';
import { ToastProvider } from '../../components/toast';

type NavItem = { href: string; label: string; icon: JSX.Element; superOnly?: boolean };

function I({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d={d} />
    </svg>
  );
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <I d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" /> },
  { href: '/stores', label: 'Lojas', icon: <I d="M3 9l1.5-5h15L21 9M4 9h16v11H4zM9 20v-6h6v6" /> },
  { href: '/products', label: 'Produtos', icon: <I d="M20 7L12 3 4 7m16 0l-8 4-8-4m16 0v10l-8 4-8-4V7" /> },
  { href: '/catalog', label: 'Catálogo', icon: <I d="M4 6h16M4 12h16M4 18h10M18 16l3 3-3 3" /> },
  { href: '/videos', label: 'Vídeos', icon: <I d="M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /> },
  { href: '/goals', label: 'Metas', icon: <I d="M12 12l7-7m-7 7a3 3 0 100 .01M12 3a9 9 0 109 9" /> },
  { href: '/users', label: 'Usuários', icon: <I d="M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 8a4 4 0 100-8 4 4 0 000 8m14 12v-2a4 4 0 00-3-3.87M16 0.13a4 4 0 010 7.75" /> },
  { href: '/customers', label: 'Clientes', icon: <I d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87" /> },
  { href: '/sales', label: 'Vendas', icon: <I d="M3 3v18h18M7 15l3-3 3 3 5-6" /> },
  { href: '/commissions', label: 'Comissões', icon: <I d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /> },
  { href: '/payouts', label: 'Pagamentos', icon: <I d="M2 7h20v10H2zM2 11h20M6 15h4" /> },
  { href: '/orgs', label: 'Organizações', icon: <I d="M3 21h18M6 21V7l6-4 6 4v14M10 12h.01M14 12h.01M10 16h.01M14 16h.01" />, superOnly: true },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (me.user.must_change_password) router.replace('/change-password');
  }, [loading, me, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">Carregando…</div>
    );
  }
  if (!me) return null;

  const isSuper = me.role === 'super_admin';
  const items = NAV.filter((n) => !n.superOnly || isSuper);
  const active = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">O</span>
          <span className="text-lg font-semibold tracking-tight">OpenRate</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ' +
                (active(n.href)
                  ? 'bg-brand/10 text-brand'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900')
              }
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-3 text-sm">
          <div className="mb-1 truncate font-medium text-neutral-800">{me.user.full_name ?? me.user.email}</div>
          <div className="mb-2 flex items-center gap-2">
            <span className="badge badge-neutral">{me.role}</span>
            {me.org ? (
              <span className="badge badge-green truncate">{me.org.name}</span>
            ) : isSuper ? (
              <Link href="/orgs" className="badge badge-amber">selecione uma org</Link>
            ) : null}
          </div>
          <button className="btn-ghost btn-sm w-full" onClick={logout}>Sair</button>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <span className="text-lg font-semibold">OpenRate</span>
        <button className="btn-ghost btn-sm" onClick={logout}>Sair</button>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2 py-2 md:hidden">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ' +
              (active(n.href) ? 'bg-brand/10 text-brand' : 'text-neutral-600')
            }
          >
            {n.label}
          </Link>
        ))}
      </nav>

      {/* Conteúdo */}
      <div className="min-w-0 flex-1">
        {isSuper && !me.org && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
            Você é super_admin e ainda não entrou em nenhuma organização —{' '}
            <Link href="/orgs" className="font-semibold underline">crie/entre numa org</Link> para
            cadastrar lojas, produtos e metas.
          </div>
        )}
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </div>
    </div>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </AuthProvider>
  );
}
