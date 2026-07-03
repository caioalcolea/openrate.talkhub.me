'use client';
import { useAuth } from '../../../lib/auth';

export default function Dashboard() {
  const { me } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Painel</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-neutral-500">Organização</p>
          <p className="text-lg font-semibold">{me?.org?.name ?? '—'}</p>
        </div>
        <div className="card">
          <p className="text-sm text-neutral-500">Loja</p>
          <p className="text-lg font-semibold">{me?.store?.name ?? 'Todas'}</p>
        </div>
        <div className="card">
          <p className="text-sm text-neutral-500">Papel</p>
          <p className="text-lg font-semibold">{me?.role}</p>
        </div>
      </div>
      <p className="text-neutral-600">
        Cadastre produtos, gere ideias por IA e acompanhe os vídeos dos atendentes.
      </p>
    </div>
  );
}
