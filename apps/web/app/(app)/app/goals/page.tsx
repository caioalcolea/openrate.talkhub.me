'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

interface Progress {
  target_videos: number;
  videos_submitted: number;
  videos_approved: number;
  goal_met: boolean;
  progress_pct: number;
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
            {r.videos_submitted}/{r.target_videos} vídeos enviados · {r.videos_approved} aprovados
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
