'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

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

const TEMPLATE = 'platform,externalId,affiliateShortCode,amount,commissionableAmount,soldAt\ntiktok,ORDER-001,abc12345,199.90,20.00,2026-07-01T10:00:00Z';

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [csv, setCsv] = useState(TEMPLATE);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setSales(await api<Sale[]>('/v1/affiliate-sales'));
  }
  useEffect(() => {
    void load();
  }, []);

  async function importCsv() {
    setBusy(true);
    try {
      setReport(await api<ImportReport>('/v1/affiliate-sales/import', { method: 'POST', body: { csv } }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Vendas de afiliado</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Importar (CSV)</h2>
        <p className="text-sm text-neutral-500">
          Colunas: platform, externalId, affiliateShortCode, amount, commissionableAmount, soldAt. Re-importar não duplica.
        </p>
        <textarea className="input h-40 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
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

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Vendas</h2>
        {sales.map((s) => (
          <div key={s.id} className="card text-sm">
            {s.platform} · {s.external_id} · R$ {s.gross_amount} · <b>{s.status}</b>
          </div>
        ))}
        {sales.length === 0 && <p className="text-neutral-500">Nenhuma venda importada.</p>}
      </section>
    </div>
  );
}
