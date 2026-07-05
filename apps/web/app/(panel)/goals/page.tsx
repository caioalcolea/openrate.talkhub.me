'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { GOAL_METRICS, type CreateGoalInput, type GoalMetric } from '@openrate/shared';
import { brl } from '../../../lib/format';

interface Goal {
  id: string;
  name: string;
  period: string;
  metric: GoalMetric;
  target_value: string;
}

const METRIC_LABELS: Record<GoalMetric, string> = {
  videos_recorded: 'Vídeos gravados',
  videos_published: 'Vídeos publicados',
  views: 'Visualizações',
  affiliate_revenue: 'Receita de afiliado (R$)',
};

const isMoney = (m: GoalMetric) => m === 'affiliate_revenue';

function targetLabel(g: Goal): string {
  return isMoney(g.metric) ? brl(g.target_value) : `${Number(g.target_value)} ${METRIC_LABELS[g.metric].toLowerCase()}`;
}

export default function GoalsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Goal[] | null>(null);
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<GoalMetric>('videos_recorded');
  const [target, setTarget] = useState('2');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setItems(await api<Goal[]>('/v1/goals'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: CreateGoalInput = { name, period: 'daily', metric, targetValue: Number(target) };
    try {
      await api('/v1/goals', { method: 'POST', body });
      toast.success('Meta definida.');
      setName('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Metas</h1>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Nome da meta</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Meta diária de vídeos"
            required
          />
        </div>
        <div>
          <label className="label">Métrica</label>
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
            {GOAL_METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{isMoney(metric) ? 'Valor alvo (R$)' : 'Valor alvo (por dia)'}</label>
          <input
            className="input w-32"
            type="number"
            min="0"
            step={isMoney(metric) ? '0.01' : '1'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <button className="btn" type="submit" disabled={busy || !name}>Definir meta diária</button>
      </form>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🎯</span>
          Nenhuma meta ativa. Defina uma meta diária para os atendentes.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((g) => (
            <div key={g.id} className="card flex items-center justify-between gap-3 text-sm">
              <b>{g.name}</b>
              <span className="flex items-center gap-2">
                <span className="badge badge-neutral">{METRIC_LABELS[g.metric]}</span>
                <span className="text-neutral-500">{g.period} · {targetLabel(g)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
