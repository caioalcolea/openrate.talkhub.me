'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

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

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setPayouts(await api<Payout[]>('/v1/payouts'));
  }
  useEffect(() => {
    void load();
  }, []);

  async function close() {
    setBusy('close');
    setMsg(null);
    try {
      await api('/v1/settlements/close', { method: 'POST', body: { period } });
      setMsg('Fechamento enfileirado — os payouts aparecem em instantes (atualize).');
    } finally {
      setBusy(null);
    }
  }
  async function approve(id: string) {
    setBusy(id);
    await api(`/v1/payouts/${id}/approve`, { method: 'POST' });
    await load();
    setBusy(null);
  }
  async function pay(id: string) {
    const proof = prompt('Comprovante/observação do Pix (opcional):') ?? undefined;
    setBusy(id);
    await api(`/v1/payouts/${id}/pay`, { method: 'POST', body: { proof } });
    await load();
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Fechamento e pagamentos</h1>
      <div className="card flex items-end gap-3">
        <div>
          <label className="text-sm text-neutral-500">Período (AAAA-MM)</label>
          <input className="input w-40" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-07" />
        </div>
        <button className="btn" disabled={busy === 'close'} onClick={close}>Fechar período</button>
        <button className="btn bg-neutral-600" onClick={() => void load()}>Atualizar</button>
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      <div className="flex flex-col gap-2">
        {payouts.map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div className="text-sm">
              <p>
                <b>R$ {p.total_amount}</b> · {p.period_start} a {p.period_end} · {p.status}
              </p>
              <p className="text-xs text-neutral-500">Pix: {p.pix_key ?? '— (atendente sem chave)'}</p>
            </div>
            <div className="flex gap-2">
              {p.status === 'pending_approval' && (
                <button className="btn" disabled={busy === p.id} onClick={() => approve(p.id)}>Aprovar</button>
              )}
              {p.status === 'approved' && (
                <button className="btn" disabled={busy === p.id} onClick={() => pay(p.id)}>Registrar pagamento</button>
              )}
              {p.status === 'paid' && <span className="text-sm text-green-700">Pago ✅</span>}
            </div>
          </div>
        ))}
        {payouts.length === 0 && <p className="text-neutral-500">Nenhum payout. Feche um período.</p>}
      </div>
    </div>
  );
}
