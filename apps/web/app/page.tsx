import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold text-brand">OpenRate</h1>
      <p className="text-neutral-600">
        Roteiros por IA, gravação guiada e comissão via Pix — 100% no navegador.
      </p>
      <div className="flex gap-3">
        <Link className="btn" href="/login">
          Entrar
        </Link>
        <Link className="btn bg-neutral-700" href="/app">
          Sou atendente
        </Link>
      </div>
    </main>
  );
}
