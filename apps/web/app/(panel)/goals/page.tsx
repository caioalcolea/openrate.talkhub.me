'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { CreateGoalInput } from '@openrate/shared';

interface Goal {
  id: string;
  period: string;
  target_videos: number;
}

export default function GoalsPage() {
  const [items, setItems] = useState<Goal[]>([]);
  const [target, setTarget] = useState('2');

  async function load() {
    setItems(await api<Goal[]>('/v1/goals'));
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateGoalInput = { period: 'daily', targetVideos: Number(target) };
    await api('/v1/goals', { method: 'POST', body });
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Metas</h1>
      <form onSubmit={create} className="card flex items-end gap-3">
        <div>
          <label className="text-sm text-neutral-500">Vídeos por dia</label>
          <input className="input" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <button className="btn" type="submit">Definir meta diária</button>
      </form>
      <div className="flex flex-col gap-2">
        {items.map((g) => (
          <div key={g.id} className="card text-sm">
            {g.period}: <b>{g.target_videos}</b> vídeos
          </div>
        ))}
        {items.length === 0 && <p className="text-neutral-500">Nenhuma meta ativa.</p>}
      </div>
    </div>
  );
}
