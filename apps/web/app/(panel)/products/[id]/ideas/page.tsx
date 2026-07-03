'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../../../lib/api';

interface VideoType {
  id: string;
  name: string;
}
interface Idea {
  id: string;
  hook: string;
  caption: string;
  hashtags: string[];
  target_duration_seconds: number;
  archived: boolean;
}

export default function IdeasPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [types, setTypes] = useState<VideoType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setIdeas(await api<Idea[]>(`/v1/products/${productId}/ideas`));
  }
  useEffect(() => {
    void api<VideoType[]>('/v1/video-types').then((t) => {
      setTypes(t);
      if (t[0]) setTypeId(t[0].id);
    });
    void load();
  }, [productId]);

  async function generate() {
    if (!typeId) return;
    await api(`/v1/products/${productId}/generate-ideas`, {
      method: 'POST',
      body: { videoTypeId: typeId, count: 40, regenerate: false },
    });
    setMsg('Geração enfileirada — as ideias aparecem em ~2 min (acompanhe no Bull Board).');
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Ideias de vídeo</h1>
      <div className="card flex items-end gap-3">
        <div>
          <label className="text-sm text-neutral-500">Tipo de vídeo</label>
          <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={generate}>Gerar 40 ideias (IA)</button>
        <button className="btn bg-neutral-600" onClick={() => void load()}>Atualizar</button>
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ideas.map((i) => (
          <div key={i.id} className="card">
            <p className="font-medium">{i.hook}</p>
            <p className="mt-1 text-sm text-neutral-600">{i.caption}</p>
            <p className="mt-2 text-xs text-neutral-400">{i.hashtags.join(' ')} · {i.target_duration_seconds}s</p>
          </div>
        ))}
        {ideas.length === 0 && <p className="text-neutral-500">Nenhuma ideia ainda — gere pela IA.</p>}
      </div>
    </div>
  );
}
