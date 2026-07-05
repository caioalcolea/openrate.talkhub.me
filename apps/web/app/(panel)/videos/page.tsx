'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, openSignedUrl } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { Modal } from '../../../components/modal';
import { dateTime } from '../../../lib/format';

interface Video {
  id: string;
  status: string;
  duration_seconds: number | null;
  thumb_key: string | null;
  created_at: string;
}

// Estados em que o vídeo final já existe no storage (download habilitado).
const DOWNLOADABLE = new Set(['ready', 'approved', 'published']);

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: 'Processando', cls: 'badge-amber' },
  ready: { label: 'Aguardando aprovação', cls: 'badge-blue' },
  approved: { label: 'Aprovado', cls: 'badge-green' },
  rejected: { label: 'Reprovado', cls: 'badge-red' },
  failed: { label: 'Falhou', cls: 'badge-red' },
};

export default function VideosPage() {
  const toast = useToast();
  const [items, setItems] = useState<Video[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

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
  }, []);

  async function approve(id: string) {
    setBusy(id);
    try {
      await api(`/v1/videos/${id}/approve`, { method: 'POST' });
      toast.success('Vídeo aprovado.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function download(id: string, kind: 'final' | 'thumb') {
    setBusy(id);
    try {
      await openSignedUrl(`/v1/videos/${id}/download?kind=${kind}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirmReject() {
    if (!rejectId || reason.trim().length < 3) return;
    const id = rejectId;
    setBusy(id);
    try {
      await api(`/v1/videos/${id}/reject`, { method: 'POST', body: { reason: reason.trim() } });
      toast.success('Vídeo reprovado.');
      setRejectId(null);
      setReason('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Fila de aprovação de vídeos</h1>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🎬</span>
          Nenhum vídeo ainda. Assim que um atendente gravar e enviar, ele aparece aqui para aprovação.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((v) => {
            const s = STATUS[v.status] ?? { label: v.status, cls: 'badge-neutral' };
            return (
              <div key={v.id} className="card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                    <span className="text-xs text-neutral-500">
                      {v.duration_seconds ? `${v.duration_seconds}s · ` : ''}
                      {dateTime(v.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-neutral-400">{v.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {DOWNLOADABLE.has(v.status) && (
                    <button className="btn-ghost btn-sm" disabled={busy === v.id} onClick={() => download(v.id, 'final')}>
                      Baixar
                    </button>
                  )}
                  {v.thumb_key && (
                    <button className="btn-ghost btn-sm" disabled={busy === v.id} onClick={() => download(v.id, 'thumb')}>
                      Thumb
                    </button>
                  )}
                  {v.status === 'ready' && (
                    <>
                      <button className="btn btn-sm" disabled={busy === v.id} onClick={() => approve(v.id)}>
                        Aprovar
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        disabled={busy === v.id}
                        onClick={() => {
                          setRejectId(v.id);
                          setReason('');
                        }}
                      >
                        Reprovar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={rejectId !== null}
        onClose={() => setRejectId(null)}
        title="Reprovar vídeo"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setRejectId(null)}>Cancelar</button>
            <button className="btn-danger" disabled={reason.trim().length < 3 || busy !== null} onClick={confirmReject}>
              Reprovar
            </button>
          </>
        }
      >
        <label className="label">Motivo da reprovação (o atendente será notificado)</label>
        <textarea
          className="textarea"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: áudio baixo, faltou mostrar o produto…"
        />
      </Modal>
    </div>
  );
}
