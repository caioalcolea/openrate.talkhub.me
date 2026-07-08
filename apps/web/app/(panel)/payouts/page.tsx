'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, downloadFile, openSignedUrl } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { Modal } from '../../../components/modal';
import { brl, date } from '../../../lib/format';

interface Payout {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  total_amount: string;
  status: string;
  pix_key: string | null;
  paid_at: string | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_approval: { label: 'Aguardando aprovação', cls: 'badge-amber' },
  approved: { label: 'Aprovado', cls: 'badge-blue' },
  paid: { label: 'Pago', cls: 'badge-green' },
  cancelled: { label: 'Cancelado', cls: 'badge-neutral' },
};

export default function PayoutsPage() {
  const toast = useToast();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [busy, setBusy] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const [proof, setProof] = useState('');

  async function load() {
    try {
      setPayouts(await api<Payout[]>('/v1/payouts'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setPayouts([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function close() {
    setBusy('close');
    try {
      await api('/v1/settlements/close', { method: 'POST', body: { period } });
      toast.success('Fechamento enfileirado — os payouts aparecem em instantes.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: string) {
    setBusy(id);
    try {
      await api(`/v1/payouts/${id}/approve`, { method: 'POST' });
      toast.success('Payout aprovado.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function receipt(id: string) {
    setBusy(id);
    try {
      await openSignedUrl(`/v1/payouts/${id}/receipt`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    try {
      await downloadFile('/v1/payouts/export.csv', 'payouts.csv');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function confirmPay() {
    if (!payId) return;
    const id = payId;
    setBusy(id);
    try {
      await api(`/v1/payouts/${id}/pay`, {
        method: 'POST',
        body: { proof: proof.trim() || undefined },
      });
      toast.success('Pagamento registrado.');
      setPayId(null);
      setProof('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Fechamento e pagamentos</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Período (AAAA-MM)</label>
          <input className="input w-40" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-07" />
        </div>
        <button className="btn" disabled={busy === 'close'} onClick={close}>
          {busy === 'close' ? 'Fechando…' : 'Fechar período'}
        </button>
        <button className="btn-ghost" onClick={() => void load()}>Atualizar</button>
        <button className="btn-ghost ml-auto" onClick={exportCsv}>Exportar CSV</button>
      </div>

      {payouts === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : payouts.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">💸</span>
          Nenhum payout ainda. Feche um período para gerar os pagamentos dos atendentes.
        </div>
      ) : (
        <div className="space-y-2">
          {payouts.map((p) => {
            const s = STATUS[p.status] ?? { label: p.status, cls: 'badge-neutral' };
            return (
              <div key={p.id} className="card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="stat-value">{brl(p.total_amount)}</span>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {date(p.period_start)} a {date(p.period_end)}
                    {' · '}Pix: {p.pix_key ?? '— (atendente sem chave)'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {p.status === 'pending_approval' && (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => approve(p.id)}>
                      Aprovar
                    </button>
                  )}
                  {p.status === 'approved' && (
                    <button
                      className="btn btn-sm"
                      disabled={busy === p.id}
                      onClick={() => {
                        setPayId(p.id);
                        setProof('');
                      }}
                    >
                      Registrar pagamento
                    </button>
                  )}
                  {p.status === 'paid' && (
                    <button className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => receipt(p.id)}>
                      {busy === p.id ? '…' : 'Recibo'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={payId !== null}
        onClose={() => setPayId(null)}
        title="Registrar pagamento"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPayId(null)}>Cancelar</button>
            <button className="btn" disabled={busy !== null} onClick={confirmPay}>
              Confirmar pagamento
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          Confirme que o Pix foi enviado. Você pode anexar um comprovante ou observação (opcional).
        </p>
        <label className="label">Comprovante / observação</label>
        <textarea
          className="textarea"
          rows={3}
          value={proof}
          onChange={(e) => setProof(e.target.value)}
          placeholder="Ex.: ID da transação Pix, data/hora…"
        />
      </Modal>
    </div>
  );
}
