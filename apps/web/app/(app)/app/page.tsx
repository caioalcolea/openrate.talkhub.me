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
  const releasePending = me.user.image_release_status !== 'signed';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Olá, {me.user.full_name ?? 'creator'} 👋</h1>
      {releasePending && (
        <Link
          href="/app/image-release"
          className="block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          📝 <b>Assine a cessão de imagem</b> para liberar a gravação de vídeos. Toque para assinar.
        </Link>
      )}
      <p className="text-neutral-600">Escolha um produto, pegue uma ideia e grave seu vídeo.</p>
      <Link className="btn" href="/app/products">Ver produtos</Link>
      <Link className="btn bg-neutral-700" href="/app/upload">Enviar vídeos pendentes</Link>
    </div>
  );
}
