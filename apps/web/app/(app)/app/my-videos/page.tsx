'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

interface Video {
  id: string;
  status: string;
  created_at: string;
}

const LABELS: Record<string, string> = {
  processing: 'Processando…',
  ready: 'Pronto (aguardando aprovação)',
  approved: 'Aprovado ✅',
  rejected: 'Reprovado ❌',
  failed: 'Falhou',
};

export default function MyVideos() {
  const [items, setItems] = useState<Video[]>([]);

  async function load() {
    setItems(await api<Video[]>('/v1/videos'));
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000); // polling
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Meus vídeos</h1>
      {items.map((v) => (
        <div key={v.id} className="card">
          <p className="text-sm font-medium">{LABELS[v.status] ?? v.status}</p>
          <p className="text-xs text-neutral-500">{new Date(v.created_at).toLocaleString('pt-BR')}</p>
        </div>
      ))}
      {items.length === 0 && <p className="text-neutral-500">Nenhum vídeo ainda.</p>}
    </div>
  );
}
