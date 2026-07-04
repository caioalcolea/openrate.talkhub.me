'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import type { CreateGoalInput } from '@openrate/shared';

interface Goal {
  id: string;
  name: string;
  period: string;
  target_videos: number;
}

export default function GoalsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Goal[] | null>(null);
  const [name, setName] = useState('');
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
    const body: CreateGoalInput = { name, period: 'daily', targetVideos: Number(target) };
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
        <div className="flex-1">
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
          <label className="label">Vídeos por dia</label>
          <input className="input w-32" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} />
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
          Nenhuma meta ativa. Defina uma meta diária de vídeos para os atendentes.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((g) => (
            <div key={g.id} className="card text-sm">
              <b>{g.name}</b> — {g.period}: {g.target_videos} vídeos
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
