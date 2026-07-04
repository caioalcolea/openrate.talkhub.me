'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl } from '../../../lib/format';

interface Dashboard {
  sales: { count: number; gross: string };
  commissionByType: { beneficiary_type: string; total: string }[];
  videosByStatus: { status: string; count: number }[];
  topCreators: { user_id: string; full_name: string; total: string }[];
}

const VIDEO_STATUS_LABEL: Record<string, string> = {
  processing: 'Processando',
  ready: 'Aguardando aprovação',
  approved: 'Aprovados',
  rejected: 'Reprovados',
  published: 'Publicados',
  failed: 'Falhas',
};

export default function DashboardPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<Dashboard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<Dashboard>('/v1/dashboard')
      .then((res) => setD(res))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="space-y-4">
      <h1>Painel{me?.org?.name ? ` · ${me.org.name}` : ''}</h1>

      {!loaded ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="stat">
              <p className="stat-label">Vendas confirmadas</p>
              <p className="stat-value">{d?.sales.count ?? 0}</p>
              <p className="text-sm text-neutral-500">{brl(d?.sales.gross ?? 0)}</p>
            </div>
            {(d?.commissionByType ?? []).map((c) => (
              <div key={c.beneficiary_type} className="stat">
                <p className="stat-label">Comissão {c.beneficiary_type}</p>
                <p className="stat-value">{brl(c.total)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card">
              <p className="mb-2 font-semibold">Vídeos por status</p>
              {(d?.videosByStatus ?? []).map((v) => (
                <p key={v.status} className="text-sm">
                  {VIDEO_STATUS_LABEL[v.status] ?? v.status}: <b>{v.count}</b>
                </p>
              ))}
              {(d?.videosByStatus ?? []).length === 0 && <p className="text-sm text-neutral-500">Sem vídeos ainda.</p>}
            </div>
            <div className="card">
              <p className="mb-2 font-semibold">Top creators</p>
              {(d?.topCreators ?? []).map((c, i) => (
                <p key={c.user_id} className="text-sm">
                  {i + 1}. {c.full_name} — {brl(c.total)}
                </p>
              ))}
              {(d?.topCreators ?? []).length === 0 && <p className="text-sm text-neutral-500">Sem dados ainda.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
