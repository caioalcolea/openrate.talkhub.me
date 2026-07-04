'use client';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';

export default function AppHome() {
  const { me, loading } = useAuth();
  if (loading) return <p className="text-neutral-500">Carregando…</p>;
  if (!me)
    return (
      <div className="flex flex-col gap-3">
        <p>Você precisa entrar para gravar.</p>
        <Link className="btn" href="/login">Entrar</Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Olá, {me.user.full_name ?? 'creator'} 👋</h1>
      <p className="text-neutral-600">Escolha um produto, pegue uma ideia e grave seu vídeo.</p>
      <Link className="btn" href="/app/products">Ver produtos</Link>
      <Link className="btn bg-neutral-700" href="/app/upload">Enviar vídeos pendentes</Link>
    </div>
  );
}
