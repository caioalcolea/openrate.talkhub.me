'use client';
import Link from 'next/link';
import { AuthProvider } from '../../lib/auth';
import { ToastProvider } from '../../components/toast';

// Shell mobile-first do PWA do atendente.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="mx-auto flex min-h-screen max-w-md flex-col">
          <header className="flex items-center justify-between border-b bg-white px-4 py-3">
            <Link href="/app" className="font-semibold text-brand">OpenRate</Link>
            <Link href="/app/my-videos" className="text-sm text-neutral-600">Meus vídeos</Link>
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
