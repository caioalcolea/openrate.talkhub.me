'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import type { GoalMetric } from '@openrate/shared';
import { brl } from '../../../../lib/format';

interface Progress {
  metric: GoalMetric;
  target_value: string;
  current_value: string;
  goal_met: boolean;
  progress_pct: number;
}

const METRIC_LABELS: Record<GoalMetric, string> = {
  videos_recorded: 'vídeos gravados',
  videos_published: 'vídeos publicados',
  views: 'visualizações',
  affiliate_revenue: 'em vendas',
};

function fmt(metric: GoalMetric, value: string): string {
  return metric === 'affiliate_revenue' ? brl(value) : String(Number(value));
}

export default function AppGoals() {
  const [rows, setRows] = useState<Progress[]>([]);
  useEffect(() => {
    void api<Progress[]>('/v1/goals/progress').then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Minha meta de hoje</h1>
      {rows.length === 0 && <p className="text-neutral-500">Sem meta definida para hoje.</p>}
      {rows.map((r, i) => (
        <div key={i} className="card">
          <p className="text-sm">
            {fmt(r.metric, r.current_value)}/{fmt(r.metric, r.target_value)} {METRIC_LABELS[r.metric]}
          </p>
          <div className="mt-2 h-2 w-full rounded bg-neutral-200">
            <div
              className="h-2 rounded bg-brand"
              style={{ width: `${Math.min(100, Math.round(r.progress_pct))}%` }}
            />
          </div>
          {r.goal_met && <p className="mt-1 text-sm text-green-700">Meta batida! 🎯</p>}
        </div>
      ))}
    </div>
  );
}
