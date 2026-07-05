'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl } from '../../../lib/format';
import { COMMISSION_BASES, type CommissionBase, type CreateCommissionRuleInput } from '@openrate/shared';

interface Rule {
  id: string;
  name: string;
  store_id: string | null;
  product_id: string | null;
  category_id: string | null;
  platform: string | null;
  calc_base: CommissionBase;
  creator_pct: string;
  store_pct: string;
  platform_pct: string;
  priority: number;
  active: boolean;
}

const BASE_LABELS: Record<CommissionBase, string> = {
  affiliate_payout: 'Comissão de afiliado',
  gross_sale: 'Valor bruto da venda',
};
interface Entry {
  id: string;
  beneficiary_type: string;
  amount: string;
  base_amount: string;
  status: string;
}
interface SimResult {
  rule: { id: string; creatorPct: number; storePct: number; platformPct: number } | null;
  split: { creator: number; store: number; platform: number } | null;
  message?: string;
}

export default function CommissionsPage() {
  const toast = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState({ name: '', calcBase: 'affiliate_payout' as CommissionBase, creatorPct: '10', storePct: '5', platformPct: '5' });
  const [sim, setSim] = useState({ amount: '100' });
  const [simOut, setSimOut] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [r, e] = await Promise.all([
        api<Rule[]>('/v1/commission-rules'),
        api<Entry[]>('/v1/commission-entries'),
      ]);
      setRules(r);
      setEntries(e);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setRules([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: CreateCommissionRuleInput = {
      name: form.name || undefined,
      calcBase: form.calcBase,
      creatorPct: Number(form.creatorPct),
      storePct: Number(form.storePct),
      platformPct: Number(form.platformPct),
    };
    try {
      await api('/v1/commission-rules', { method: 'POST', body });
      toast.success('Regra criada.');
      setForm((f) => ({ ...f, name: '' }));
      await load();
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSimOut(await api<SimResult>('/v1/commission-rules/simulate', { method: 'POST', body: { amount: Number(sim.amount) } }));
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : String(e2));
    }
  }

  return (
    <div className="space-y-6">
      <h1>Comissões</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">Regras (mais específica vence)</h2>
        <form onSubmit={createRule} className="card flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label className="label">Nome da regra</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Padrão da rede" required />
          </div>
          <div className="min-w-[12rem]">
            <label className="label">Base do cálculo</label>
            <select className="select" value={form.calcBase} onChange={(e) => setForm({ ...form, calcBase: e.target.value as CommissionBase })}>
              {COMMISSION_BASES.map((b) => (
                <option key={b} value={b}>{BASE_LABELS[b]}</option>
              ))}
            </select>
          </div>
          {(['creatorPct', 'storePct', 'platformPct'] as const).map((k) => (
            <div key={k}>
              <label className="label">{k.replace('Pct', '')} %</label>
              <input className="input w-24" type="number" step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn" type="submit" disabled={busy || !form.name}>Criar regra global</button>
        </form>
        {rules === null ? (
          <div className="skeleton h-12 w-full" />
        ) : rules.length === 0 ? (
          <div className="empty">Nenhuma regra. Crie a primeira acima — ela vale para toda a organização.</div>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="card text-sm">
                <div className="flex items-center gap-2">
                  <b>{r.name}</b>
                  <span className="badge badge-blue">{BASE_LABELS[r.calc_base] ?? r.calc_base}</span>
                  <span className="text-xs text-neutral-400">prioridade {r.priority}</span>
                </div>
                <div className="mt-1 text-neutral-600">
                  creator {r.creator_pct}% / loja {r.store_pct}% / plataforma {r.platform_pct}%
                  {r.platform && ` · ${r.platform}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Simulador</h2>
        <form onSubmit={simulate} className="card flex items-end gap-3">
          <div>
            <label className="label">Valor da venda (R$)</label>
            <input className="input w-32" type="number" step="0.01" value={sim.amount} onChange={(e) => setSim({ amount: e.target.value })} />
          </div>
          <button className="btn" type="submit">Simular rateio</button>
        </form>
        {simOut && (
          <div className="card text-sm">
            {simOut.split ? (
              <p>
                creator {brl(simOut.split.creator)} · loja {brl(simOut.split.store)} · plataforma {brl(simOut.split.platform)}
              </p>
            ) : (
              <p className="text-neutral-500">{simOut.message}</p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Extrato de lançamentos</h2>
        <div className="space-y-1">
          {entries.map((e) => (
            <div key={e.id} className="card text-sm">
              {e.beneficiary_type}: {brl(e.amount)} (base {brl(e.base_amount)}) · {e.status}
            </div>
          ))}
          {entries.length === 0 && <p className="text-neutral-500">Nenhum lançamento ainda.</p>}
        </div>
      </section>
    </div>
  );
}
