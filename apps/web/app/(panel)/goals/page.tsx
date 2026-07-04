'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import type { CreateGoalInput } from '@openrate/shared';

interface Goal {
  id: string;
  name: string;
  period: string;
  target_videos: number;
}

export default function GoalsPage() {
  const [items, setItems] = useState<Goal[]>([]);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('2');
  const [error, setError] = useState('');

  async function load() {
    try {
      setItems(await api<Goal[]>('/v1/goals'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body: CreateGoalInput = { name, period: 'daily', targetVideos: Number(target) };
    try {
      await api('/v1/goals', { method: 'POST', body });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Metas</h1>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="text-sm text-neutral-500">Nome da meta</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Meta diária de vídeos"
            required
          />
        </div>
        <div>
          <label className="text-sm text-neutral-500">Vídeos por dia</label>
          <input className="input" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={!name}>Definir meta diária</button>
      </form>
      <div className="flex flex-col gap-2">
        {items.map((g) => (
          <div key={g.id} className="card text-sm">
            <b>{g.name}</b> — {g.period}: {g.target_videos} vídeos
          </div>
        ))}
        {items.length === 0 && <p className="text-neutral-500">Nenhuma meta ativa.</p>}
      </div>
    </div>
  );
}
