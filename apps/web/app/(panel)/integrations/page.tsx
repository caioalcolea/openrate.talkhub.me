'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';

interface Status {
  asaas: boolean;
  olist: boolean;
  metricsSync: boolean;
}

export default function IntegrationsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<Status>('/v1/integrations')
      .then(setStatus)
      .catch((e) => {
        toast.error(e instanceof ApiError ? e.message : String(e));
        setStatus({ asaas: false, olist: false, metricsSync: false });
      });
  }, []);

  async function run(key: string, path: string, body?: unknown, ok?: (r: unknown) => string) {
    setBusy(key);
    try {
      const r = await api<unknown>(path, { method: 'POST', body });
      toast.success(ok ? ok(r) : 'Sincronização enfileirada.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const Badge = ({ on }: { on: boolean }) => (
    <span className={`badge ${on ? 'badge-green' : 'badge-neutral'}`}>{on ? 'Habilitada' : 'Fase Escala'}</span>
  );

  return (
    <div className="space-y-4">
      <h1>Integrações</h1>
      <p className="text-sm text-neutral-500">
        Conectores externos da fase de escala. Cada um é habilitado quando a credencial é configurada
        no ambiente; enquanto isso, os disparos ficam indisponíveis.
      </p>

      {status === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card space-y-2">
            <div className="flex items-center gap-2">
              <b>Asaas</b> <Badge on={status.asaas} />
            </div>
            <p className="text-sm text-neutral-600">
              Pagamento automático de comissões via Pix. O disparo é por repasse, na tela de{' '}
              <b>Pagamentos</b> (“Pagar via Pix”).
            </p>
          </div>

          <div className="card space-y-2">
            <div className="flex items-center gap-2">
              <b>Métricas de vídeo</b> <Badge on={status.metricsSync} />
            </div>
            <p className="text-sm text-neutral-600">
              Coleta de visualizações/curtidas das publicações no ar (não afeta o financeiro).
            </p>
            <button
              className="btn btn-sm w-fit"
              disabled={!status.metricsSync || busy === 'metrics'}
              onClick={() =>
                run('metrics', '/v1/integrations/metrics/sync', undefined, (r) =>
                  `Métricas enfileiradas para ${(r as { enqueued: number }).enqueued} publicação(ões).`,
                )
              }
            >
              Sincronizar métricas
            </button>
          </div>

          <div className="card space-y-2">
            <div className="flex items-center gap-2">
              <b>Olist / Tiny (ERP)</b> <Badge on={status.olist} />
            </div>
            <p className="text-sm text-neutral-600">
              Sincroniza o catálogo de produtos e as vendas de balcão (ERP). A comissão nunca deriva
              daqui — apenas de vendas de afiliado.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-sm"
                disabled={!status.olist || busy === 'olist-p'}
                onClick={() => run('olist-p', '/v1/integrations/olist/sync', { kind: 'products' })}
              >
                Importar produtos
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={!status.olist || busy === 'olist-s'}
                onClick={() => run('olist-s', '/v1/integrations/olist/sync', { kind: 'sales' })}
              >
                Importar vendas de balcão
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
