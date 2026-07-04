'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { api } from '../../../lib/api';

interface Dashboard {
  sales: { count: number; gross: string };
  commissionByType: { beneficiary_type: string; total: string }[];
  videosByStatus: { status: string; count: number }[];
  topCreators: { user_id: string; full_name: string; total: string }[];
}

export default function DashboardPage() {
  const { me } = useAuth();
  const [d, setD] = useState<Dashboard | null>(null);

  useEffect(() => {
    void api<Dashboard>('/v1/dashboard').then(setD).catch(() => setD(null));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Painel · {me?.org?.name ?? ''}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-neutral-500">Vendas confirmadas</p>
          <p className="text-2xl font-semibold">{d?.sales.count ?? 0}</p>
          <p className="text-sm text-neutral-500">R$ {d?.sales.gross ?? '0.00'}</p>
        </div>
        {(d?.commissionByType ?? []).map((c) => (
          <div key={c.beneficiary_type} className="card">
            <p className="text-sm text-neutral-500">Comissão {c.beneficiary_type}</p>
            <p className="text-2xl font-semibold">R$ {c.total}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card">
          <p className="mb-2 font-semibold">Vídeos por status</p>
          {(d?.videosByStatus ?? []).map((v) => (
            <p key={v.status} className="text-sm">
              {v.status}: <b>{v.count}</b>
            </p>
          ))}
          {(d?.videosByStatus ?? []).length === 0 && <p className="text-neutral-500 text-sm">Sem vídeos.</p>}
        </div>
        <div className="card">
          <p className="mb-2 font-semibold">Top creators</p>
          {(d?.topCreators ?? []).map((c, i) => (
            <p key={c.user_id} className="text-sm">
              {i + 1}. {c.full_name} — R$ {c.total}
            </p>
          ))}
          {(d?.topCreators ?? []).length === 0 && <p className="text-neutral-500 text-sm">Sem dados.</p>}
        </div>
      </div>
    </div>
  );
}
