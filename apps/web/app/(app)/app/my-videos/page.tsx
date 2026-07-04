'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import type { PublicationPlatform } from '@openrate/shared';

interface Video {
  id: string;
  status: string;
  created_at: string;
}
interface PublishResult {
  affiliateLink: { shortCode: string; redirectUrl: string };
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
  const [links, setLinks] = useState<Record<string, string>>({});

  async function load() {
    setItems(await api<Video[]>('/v1/videos'));
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, []);

  async function publish(videoId: string) {
    const platform = prompt('Plataforma (tiktok, instagram_reels, shopee_video, kwai, mercado_livre_clips, youtube_shorts):');
    if (!platform) return;
    const destinationUrl = prompt('Cole o link de afiliado (destino):');
    if (!destinationUrl) return;
    try {
      const res = await api<PublishResult>(`/v1/videos/${videoId}/publications`, {
        method: 'POST',
        body: { platform: platform as PublicationPlatform, destinationUrl },
      });
      setLinks((l) => ({ ...l, [videoId]: res.affiliateLink.redirectUrl }));
    } catch (e) {
      alert(`Erro: ${String(e).slice(0, 120)}`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Meus vídeos</h1>
      {items.map((v) => (
        <div key={v.id} className="card">
          <p className="text-sm font-medium">{LABELS[v.status] ?? v.status}</p>
          <p className="text-xs text-neutral-500">{new Date(v.created_at).toLocaleString('pt-BR')}</p>
          {v.status === 'approved' && (
            <button className="btn mt-2 text-sm" onClick={() => publish(v.id)}>
              Registrar publicação + gerar link
            </button>
          )}
          {links[v.id] && (
            <p className="mt-2 break-all text-xs text-brand" onClick={() => navigator.clipboard?.writeText(links[v.id])}>
              🔗 {links[v.id]} (toque para copiar)
            </p>
          )}
        </div>
      ))}
      {items.length === 0 && <p className="text-neutral-500">Nenhum vídeo ainda.</p>}
    </div>
  );
}
