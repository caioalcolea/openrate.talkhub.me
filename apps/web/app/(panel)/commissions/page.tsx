'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { CreateCommissionRuleInput } from '@openrate/shared';

interface Rule {
  id: string;
  store_id: string | null;
  product_id: string | null;
  category_id: string | null;
  platform: string | null;
  creator_pct: string;
  store_pct: string;
  platform_pct: string;
  priority: number;
  active: boolean;
}
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
  const [rules, setRules] = useState<Rule[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState({ creatorPct: '10', storePct: '5', platformPct: '5' });
  const [sim, setSim] = useState({ amount: '100' });
  const [simOut, setSimOut] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setRules(await api<Rule[]>('/v1/commission-rules'));
    setEntries(await api<Entry[]>('/v1/commission-entries'));
  }
  useEffect(() => {
    void load();
  }, []);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body: CreateCommissionRuleInput = {
      creatorPct: Number(form.creatorPct),
      storePct: Number(form.storePct),
      platformPct: Number(form.platformPct),
    };
    try {
      await api('/v1/commission-rules', { method: 'POST', body });
      await load();
    } catch (e2) {
      setErr(String(e2));
    }
  }

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    setSimOut(await api<SimResult>('/v1/commission-rules/simulate', { method: 'POST', body: { amount: Number(sim.amount) } }));
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Comissões</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Regras (mais específica vence)</h2>
        <form onSubmit={createRule} className="card flex flex-wrap items-end gap-3">
          {(['creatorPct', 'storePct', 'platformPct'] as const).map((k) => (
            <div key={k}>
              <label className="text-sm text-neutral-500">{k.replace('Pct', '')} %</label>
              <input className="input w-24" type="number" step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn" type="submit">Criar regra global</button>
        </form>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div key={r.id} className="card text-sm">
              prioridade {r.priority} · creator {r.creator_pct}% / loja {r.store_pct}% / plataforma {r.platform_pct}%
              {r.platform && ` · ${r.platform}`}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Simulador</h2>
        <form onSubmit={simulate} className="card flex items-end gap-3">
          <div>
            <label className="text-sm text-neutral-500">Valor da venda (R$)</label>
            <input className="input w-32" type="number" step="0.01" value={sim.amount} onChange={(e) => setSim({ amount: e.target.value })} />
          </div>
          <button className="btn" type="submit">Simular rateio</button>
        </form>
        {simOut && (
          <div className="card text-sm">
            {simOut.split ? (
              <p>
                creator R$ {simOut.split.creator} · loja R$ {simOut.split.store} · plataforma R$ {simOut.split.platform}
              </p>
            ) : (
              <p className="text-neutral-500">{simOut.message}</p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Extrato de lançamentos</h2>
        <div className="flex flex-col gap-1">
          {entries.map((e) => (
            <div key={e.id} className="card text-sm">
              {e.beneficiary_type}: R$ {e.amount} (base R$ {e.base_amount}) · {e.status}
            </div>
          ))}
          {entries.length === 0 && <p className="text-neutral-500">Nenhum lançamento ainda.</p>}
        </div>
      </section>
    </div>
  );
}
