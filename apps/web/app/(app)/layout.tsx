'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../../lib/auth';
import { ToastProvider } from '../../components/toast';
import { NotificationsBell } from '../../components/notifications-bell';

// Redireciona para a troca de senha obrigatória no 1º acesso.
function ChangePasswordGuard() {
  const { me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (me?.user.must_change_password) router.replace('/change-password');
  }, [me, router]);
  return null;
}

// Shell mobile-first do PWA do atendente.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ChangePasswordGuard />
        <div className="mx-auto flex min-h-screen max-w-md flex-col">
          <header className="flex items-center justify-between border-b bg-white px-4 py-3">
            <Link href="/app" className="font-semibold text-brand">OpenRate</Link>
            <div className="flex items-center gap-2">
              <NotificationsBell align="right" />
              <Link href="/app/my-videos" className="text-sm text-neutral-600">Meus vídeos</Link>
            </div>
          </header>
          <main className="flex-1 p-4">{children}</main>
          <nav className="grid grid-cols-4 border-t bg-white text-center text-xs">
            <Link href="/app/products" className="py-2">Produtos</Link>
            <Link href="/app/upload" className="py-2">Enviar</Link>
            <Link href="/app/goals" className="py-2">Meta</Link>
            <Link href="/app/my-commissions" className="py-2">R$</Link>
          </nav>
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
