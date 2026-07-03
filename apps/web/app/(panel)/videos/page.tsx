'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

interface Video {
  id: string;
  status: string;
  duration_seconds: number | null;
  created_at: string;
}

export default function VideosPage() {
  const [items, setItems] = useState<Video[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setItems(await api<Video[]>('/v1/videos'));
  }
  useEffect(() => {
    void load();
  }, []);

  async function approve(id: string) {
    setBusy(id);
    await api(`/v1/videos/${id}/approve`, { method: 'POST' });
    await load();
    setBusy(null);
  }
  async function reject(id: string) {
    const reason = prompt('Motivo da reprovação:');
    if (!reason) return;
    setBusy(id);
    await api(`/v1/videos/${id}/reject`, { method: 'POST', body: { reason } });
    await load();
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Vídeos</h1>
      <div className="flex flex-col gap-2">
        {items.map((v) => (
          <div key={v.id} className="card flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-neutral-400">{v.id}</p>
              <p className="text-sm">
                status: <b>{v.status}</b> · {v.duration_seconds ?? '—'}s
              </p>
            </div>
            {v.status === 'ready' && (
              <div className="flex gap-2">
                <button className="btn" disabled={busy === v.id} onClick={() => approve(v.id)}>Aprovar</button>
                <button className="btn bg-red-600" disabled={busy === v.id} onClick={() => reject(v.id)}>Reprovar</button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-neutral-500">Nenhum vídeo ainda.</p>}
      </div>
    </div>
  );
}
