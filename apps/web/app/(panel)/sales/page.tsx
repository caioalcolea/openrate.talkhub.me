'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl } from '../../../lib/format';

interface Sale {
  id: string;
  platform: string;
  external_id: string;
  status: string;
  gross_amount: string;
}
interface RowResult {
  line: number;
  externalId?: string;
  status: string;
  message?: string;
}
interface ImportReport {
  imported: number;
  duplicated: number;
  failed: number;
  results: RowResult[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'badge-amber' },
  confirmed: { label: 'Confirmada', cls: 'badge-green' },
  cancelled: { label: 'Cancelada', cls: 'badge-neutral' },
  refunded: { label: 'Estornada', cls: 'badge-red' },
};

const TEMPLATE = 'platform,externalId,affiliateShortCode,amount,commissionableAmount,soldAt\ntiktok,ORDER-001,abc12345,199.90,20.00,2026-07-01T10:00:00Z';

export default function SalesPage() {
  const toast = useToast();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [csv, setCsv] = useState(TEMPLATE);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setSales(await api<Sale[]>('/v1/affiliate-sales'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setSales([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function importCsv() {
    setBusy(true);
    try {
      const r = await api<ImportReport>('/v1/affiliate-sales/import', { method: 'POST', body: { csv } });
      setReport(r);
      toast.success(`${r.imported} venda(s) importada(s), ${r.duplicated} duplicada(s), ${r.failed} falha(s).`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1>Vendas de afiliado</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">Importar (CSV)</h2>
        <p className="text-sm text-neutral-500">
          Colunas: platform, externalId, affiliateShortCode, amount, commissionableAmount, soldAt. Re-importar não duplica.
        </p>
        <textarea className="textarea h-40 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button className="btn w-fit" disabled={busy} onClick={importCsv}>
          {busy ? 'Importando…' : 'Importar'}
        </button>
        {report && (
          <div className="card text-sm">
            <p>
              Importadas: <b>{report.imported}</b> · Duplicadas: {report.duplicated} · Falhas: {report.failed}
            </p>
            {report.results
              .filter((r) => r.status !== 'imported')
              .map((r) => (
                <p key={r.line} className="text-xs text-neutral-500">
                  linha {r.line}: {r.status} {r.message ? `— ${r.message}` : ''}
                </p>
              ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Vendas</h2>
        {sales === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : sales.length === 0 ? (
          <div className="empty">
            <span className="text-2xl">🧾</span>
            Nenhuma venda importada ainda. Cole um CSV acima para começar.
          </div>
        ) : (
          sales.map((s) => {
            const st = STATUS[s.status] ?? { label: s.status, cls: 'badge-neutral' };
            return (
              <div key={s.id} className="card flex items-center justify-between gap-4 text-sm">
                <span className="min-w-0 truncate">
                  {s.platform} · {s.external_id}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <b>{brl(s.gross_amount)}</b>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
