'use client';
import { useEffect, useState } from 'react';
import { listPending, deletePending, type PendingVideo } from '../../../../lib/idb';
import { uploadVideo } from '../../../../lib/upload';

export default function UploadPage() {
  const [pending, setPending] = useState<PendingVideo[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});

  async function refresh() {
    setPending(await listPending());
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function send(v: PendingVideo) {
    setProgress((p) => ({ ...p, [v.id]: 'enviando…' }));
    try {
      await uploadVideo(
        { ideaId: v.ideaId, productId: v.productId, blob: v.blob, contentType: v.contentType },
        (done, total) => setProgress((p) => ({ ...p, [v.id]: `${done}/${total} partes` })),
      );
      await deletePending(v.id);
      setProgress((p) => ({ ...p, [v.id]: 'enviado ✅' }));
      await refresh();
    } catch (e) {
      setProgress((p) => ({ ...p, [v.id]: `erro: ${String(e).slice(0, 60)}` }));
    }
  }

  async function sendAll() {
    for (const v of pending) await send(v);
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Vídeos pendentes</h1>
      {pending.length === 0 && <p className="text-neutral-500">Nada na fila. Grave um vídeo primeiro.</p>}
      {pending.length > 0 && (
        <button className="btn" onClick={sendAll}>Enviar todos</button>
      )}
      {pending.map((v) => (
        <div key={v.id} className="card flex items-center justify-between">
          <div>
            <p className="text-sm">{new Date(v.createdAt).toLocaleString('pt-BR')}</p>
            <p className="text-xs text-neutral-500">
              {(v.blob.size / 1024 / 1024).toFixed(1)} MB · {progress[v.id] ?? 'na fila'}
            </p>
          </div>
          <button className="btn" onClick={() => send(v)}>Enviar</button>
        </div>
      ))}
    </div>
  );
}
