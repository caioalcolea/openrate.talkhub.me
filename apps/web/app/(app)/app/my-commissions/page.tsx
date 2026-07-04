'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';

interface Entry {
  id: string;
  beneficiary_type: string;
  user_id: string | null;
  amount: string;
  status: string;
  payable_at: string | null;
}

const STATUS: Record<string, string> = {
  pending: 'Em carência',
  payable: 'Liberada',
  settled: 'No fechamento',
  paid: 'Paga ✅',
  cancelled: 'Estornada',
};

export default function MyCommissions() {
  const { me } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    void api<Entry[]>('/v1/commission-entries').then(setEntries).catch(() => setEntries([]));
  }, []);

  // Mostra só as comissões do próprio creator.
  const mine = entries.filter((e) => e.beneficiary_type === 'creator' && e.user_id === me?.user.id);
  const total = mine
    .filter((e) => e.status !== 'cancelled')
    .reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Minhas comissões</h1>
      <div className="card">
        <p className="text-sm text-neutral-500">Total (não estornado)</p>
        <p className="text-2xl font-bold text-brand">R$ {total.toFixed(2)}</p>
      </div>
      {mine.map((e) => (
        <div key={e.id} className="card text-sm">
          R$ {e.amount} · {STATUS[e.status] ?? e.status}
          {e.payable_at && ` · libera ${new Date(e.payable_at).toLocaleDateString('pt-BR')}`}
        </div>
      ))}
      {mine.length === 0 && <p className="text-neutral-500">Nenhuma comissão ainda.</p>}
    </div>
  );
}
