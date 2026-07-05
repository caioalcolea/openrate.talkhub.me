'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, openSignedUrl } from '../../../../lib/api';
import { useToast } from '../../../../components/toast';
import { Modal } from '../../../../components/modal';
import { dateTime } from '../../../../lib/format';
import { PUBLICATION_PLATFORMS, type PublicationPlatform } from '@openrate/shared';

interface Video {
  id: string;
  status: string;
  created_at: string;
}
interface PublishResult {
  affiliateLink: { shortCode: string; redirectUrl: string };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: 'Processando', cls: 'badge-amber' },
  ready: { label: 'Aguardando aprovação', cls: 'badge-blue' },
  approved: { label: 'Aprovado', cls: 'badge-green' },
  rejected: { label: 'Reprovado', cls: 'badge-red' },
  published: { label: 'Publicado', cls: 'badge-green' },
  failed: { label: 'Falhou', cls: 'badge-red' },
};

const PLATFORM_LABELS: Record<PublicationPlatform, string> = {
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
  shopee_video: 'Shopee Video',
  kwai: 'Kwai',
  mercado_livre_clips: 'Mercado Livre Clips',
  youtube_shorts: 'YouTube Shorts',
};

export default function MyVideos() {
  const toast = useToast();
  const [items, setItems] = useState<Video[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [pubId, setPubId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PublicationPlatform>('tiktok');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setItems(await api<Video[]>('/v1/videos'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, []);

  async function confirmPublish() {
    if (!pubId || !destinationUrl.trim()) return;
    const id = pubId;
    setBusy(true);
    try {
      const res = await api<PublishResult>(`/v1/videos/${id}/publications`, {
        method: 'POST',
        body: { platform, destinationUrl: destinationUrl.trim() },
      });
      setLinks((l) => ({ ...l, [id]: res.affiliateLink.redirectUrl }));
      toast.success('Publicação registrada — link de afiliado gerado.');
      setPubId(null);
      setDestinationUrl('');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard?.writeText(link);
      toast.success('Link copiado.');
    } catch {
      toast.info(link);
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Meus vídeos</h1>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🎥</span>
          Você ainda não enviou vídeos. Grave um vídeo de um produto e envie para aprovação.
        </div>
      ) : (
        items.map((v) => {
          const s = STATUS[v.status] ?? { label: v.status, cls: 'badge-neutral' };
          return (
            <div key={v.id} className="card">
              <div className="flex items-center gap-2">
                <span className={`badge ${s.cls}`}>{s.label}</span>
                <span className="text-xs text-neutral-500">{dateTime(v.created_at)}</span>
              </div>
              {(v.status === 'approved' || v.status === 'published') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      openSignedUrl(`/v1/videos/${v.id}/download`).catch((e) =>
                        toast.error(e instanceof ApiError ? e.message : String(e)),
                      )
                    }
                  >
                    Baixar vídeo
                  </button>
                  {v.status === 'approved' && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setPubId(v.id);
                        setPlatform('tiktok');
                        setDestinationUrl('');
                      }}
                    >
                      Registrar publicação + gerar link
                    </button>
                  )}
                </div>
              )}
              {links[v.id] && (
                <button
                  className="mt-3 block break-all text-left text-xs text-brand"
                  onClick={() => copy(links[v.id])}
                >
                  🔗 {links[v.id]} <span className="text-neutral-400">(toque para copiar)</span>
                </button>
              )}
            </div>
          );
        })
      )}

      <Modal
        open={pubId !== null}
        onClose={() => setPubId(null)}
        title="Registrar publicação"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPubId(null)}>Cancelar</button>
            <button className="btn" disabled={!destinationUrl.trim() || busy} onClick={confirmPublish}>
              {busy ? 'Gerando…' : 'Gerar link'}
            </button>
          </>
        }
      >
        <label className="label">Plataforma</label>
        <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value as PublicationPlatform)}>
          {PUBLICATION_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
        <label className="label">Link de afiliado (destino)</label>
        <input
          className="input"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
        />
      </Modal>
    </div>
  );
}
