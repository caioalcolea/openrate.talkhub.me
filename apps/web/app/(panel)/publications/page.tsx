'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { dateTime } from '../../../lib/format';
import { useListControls, Pager } from '../../../components/list-controls';
import { PUBLICATION_PLATFORMS, type PublicationPlatform } from '@openrate/shared';

interface Publication {
  id: string;
  video_id: string;
  platform: PublicationPlatform;
  status: string;
  external_url: string | null;
  caption: string | null;
  published_at: string | null;
  short_code: string | null;
  clicks_count: string | number | null;
  destination_url: string | null;
  product_name: string | null;
  creator_name: string | null;
  redirect_url: string | null;
}

const PLATFORM_LABELS: Record<PublicationPlatform, string> = {
  tiktok: 'TikTok',
  instagram_reels: 'Instagram Reels',
  shopee_video: 'Shopee Video',
  kwai: 'Kwai',
  mercado_livre_clips: 'Mercado Livre Clips',
  youtube_shorts: 'YouTube Shorts',
};
const platformLabel = (p: string) => PLATFORM_LABELS[p as PublicationPlatform] ?? p;

export default function PublicationsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Publication[] | null>(null);
  const [platform, setPlatform] = useState<string>('');

  async function load() {
    try {
      setItems(await api<Publication[]>('/v1/publications'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const base = (items ?? []).filter((p) => !platform || p.platform === platform);
  const { query, setQuery, page, setPage, pageItems, total, totalPages } = useListControls<Publication>(
    base,
    (p, q) =>
      (p.product_name ?? '').toLowerCase().includes(q) ||
      (p.creator_name ?? '').toLowerCase().includes(q) ||
      (p.short_code ?? '').toLowerCase().includes(q) ||
      platformLabel(p.platform).toLowerCase().includes(q),
    20,
  );

  async function copy(link: string) {
    try {
      await navigator.clipboard?.writeText(link);
      toast.success('Link copiado.');
    } catch {
      toast.info(link);
    }
  }

  const totalClicks = (items ?? []).reduce((s, p) => s + Number(p.clicks_count ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Publicações e links de afiliado</h1>
        {items && items.length > 0 && (
          <span className="badge badge-blue">{totalClicks} cliques no total</span>
        )}
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Buscar</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produto, atendente, código…"
          />
        </div>
        <div className="min-w-[12rem]">
          <label className="label">Plataforma</label>
          <select className="select" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {PUBLICATION_PLATFORMS.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <button className="btn-ghost" onClick={() => void load()}>Atualizar</button>
      </div>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="empty">
          <span className="text-2xl">🔗</span>
          {items.length === 0
            ? 'Nenhuma publicação ainda. Quando um atendente publicar um vídeo aprovado, o link de afiliado aparece aqui.'
            : 'Nenhuma publicação corresponde ao filtro.'}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pageItems.map((p) => (
              <div key={p.id} className="card space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-neutral">{platformLabel(p.platform)}</span>
                  <span className="font-medium">{p.product_name ?? 'Produto removido'}</span>
                  <span className="badge badge-blue">{Number(p.clicks_count ?? 0)} cliques</span>
                  <span className="ml-auto text-xs text-neutral-500">{dateTime(p.published_at)}</span>
                </div>
                <div className="text-xs text-neutral-500">
                  por {p.creator_name ?? '—'}
                  {p.external_url && (
                    <>
                      {' · '}
                      <a href={p.external_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                        ver post
                      </a>
                    </>
                  )}
                </div>
                {p.redirect_url && (
                  <button
                    className="block w-full break-all rounded-lg bg-neutral-50 px-3 py-2 text-left text-xs text-brand hover:bg-neutral-100"
                    onClick={() => copy(p.redirect_url as string)}
                  >
                    🔗 {p.redirect_url} <span className="text-neutral-400">(clique para copiar)</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
