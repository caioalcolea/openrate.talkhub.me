'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '../../../../../lib/api';
import { useToast } from '../../../../../components/toast';
import { Modal } from '../../../../../components/modal';

interface VideoType {
  id: string;
  name: string;
}
interface ScriptStep {
  step: number;
  instruction: string;
  durationSeconds?: number;
}
interface Idea {
  id: string;
  hook: string;
  script: ScriptStep[];
  caption: string | null;
  hashtags: string[];
  target_duration_seconds: number | null;
  source: string;
  used_count: number;
  archived: boolean;
}

export default function IdeasPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const toast = useToast();
  const [types, setTypes] = useState<VideoType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  // manual create
  const [open, setOpen] = useState(false);
  const [hook, setHook] = useState('');
  const [steps, setSteps] = useState<{ instruction: string; duration: string }[]>([{ instruction: '', duration: '' }]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [target, setTarget] = useState('');

  const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  async function load() {
    try {
      setIdeas(await api<Idea[]>(`/v1/products/${productId}/ideas${showArchived ? '?includeArchived=true' : ''}`));
    } catch (e) {
      err(e);
      setIdeas([]);
    }
  }
  useEffect(() => {
    api<VideoType[]>('/v1/video-types').then((t) => {
      setTypes(t);
      if (t[0]) setTypeId(t[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  async function generate(regenerate: boolean) {
    if (!typeId) return toast.error('Escolha um tipo de vídeo.');
    setBusy(true);
    try {
      await api(`/v1/products/${productId}/generate-ideas`, {
        method: 'POST',
        body: { videoTypeId: typeId, count: 40, regenerate },
      });
      toast.success('Geração enfileirada — as ideias aparecem em instantes. Use “Atualizar”.');
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }

  async function createManual(e: React.FormEvent) {
    e.preventDefault();
    const script = steps
      .filter((s) => s.instruction.trim())
      .map((s, i) => ({ step: i + 1, instruction: s.instruction.trim(), durationSeconds: s.duration ? Number(s.duration) : undefined }));
    if (!hook.trim() || script.length === 0) return toast.error('Informe o gancho e ao menos um passo.');
    try {
      await api(`/v1/products/${productId}/ideas`, {
        method: 'POST',
        body: {
          videoTypeId: typeId || undefined,
          hook: hook.trim(),
          script,
          caption: caption || undefined,
          hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean),
          targetDurationSeconds: target ? Number(target) : undefined,
        },
      });
      toast.success('Ideia criada.');
      setOpen(false);
      setHook(''); setSteps([{ instruction: '', duration: '' }]); setCaption(''); setHashtags(''); setTarget('');
      await load();
    } catch (e) {
      err(e);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    try {
      await fn();
      toast.success(okMsg);
      await load();
    } catch (e) {
      err(e);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Ideias de vídeo</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem]">
          <label className="label">Tipo de vídeo</label>
          <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </div>
        <button className="btn" disabled={busy} onClick={() => generate(false)}>Gerar 40 ideias (IA)</button>
        <button className="btn-ghost" disabled={busy} onClick={() => generate(true)}>Gerar mais deste tipo</button>
        <button className="btn-ghost" onClick={() => setOpen(true)}>Criar ideia manual</button>
        <button className="btn-ghost" onClick={() => void load()}>Atualizar</button>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          mostrar arquivadas
        </label>
      </div>

      {ideas === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (<div key={i} className="skeleton h-28 w-full" />))}
        </div>
      ) : ideas.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">💡</span>
          Nenhuma ideia ainda — gere pela IA ou crie uma manual.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ideas.map((i) => (
            <div key={i.id} className={'card ' + (i.archived ? 'opacity-60' : '')}>
              <div className="flex items-center gap-2">
                <span className={`badge ${i.source === 'manual' ? 'badge-blue' : 'badge-neutral'}`}>{i.source === 'manual' ? 'Manual' : 'IA'}</span>
                {i.target_duration_seconds ? <span className="text-xs text-neutral-500">~{i.target_duration_seconds}s</span> : null}
                {i.used_count > 0 && <span className="text-xs text-neutral-400">usada {i.used_count}×</span>}
                {i.archived && <span className="badge badge-neutral">arquivada</span>}
              </div>
              <p className="mt-1 font-medium">{i.hook}</p>
              {i.script?.length > 0 && (
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-neutral-600">
                  {i.script.slice(0, 6).map((s) => (<li key={s.step}>{s.instruction}</li>))}
                </ol>
              )}
              {i.caption && <p className="mt-2 text-sm text-neutral-600">{i.caption}</p>}
              {i.hashtags?.length > 0 && <p className="mt-1 text-xs text-brand">{i.hashtags.map((h) => `#${h}`).join(' ')}</p>}
              <div className="mt-3 flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => act(() => api(`/v1/ideas/${i.id}/duplicate`, { method: 'POST' }), 'Ideia duplicada.')}>Duplicar</button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => act(() => api(`/v1/ideas/${i.id}`, { method: 'PATCH', body: { archived: !i.archived } }), i.archived ? 'Desarquivada.' : 'Arquivada.')}
                >
                  {i.archived ? 'Desarquivar' : 'Arquivar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nova ideia manual"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn" onClick={createManual}>Salvar ideia</button>
          </>
        }
      >
        <form onSubmit={createManual} className="space-y-3">
          <div>
            <label className="label">Gancho (hook)</label>
            <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} required />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Roteiro (passos)</label>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSteps((s) => [...s, { instruction: '', duration: '' }])}>+ passo</button>
            </div>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={idx} className="flex gap-2">
                  <input className="input flex-1" placeholder={`Passo ${idx + 1}`} value={s.instruction} onChange={(e) => setSteps((a) => a.map((x, j) => (j === idx ? { ...x, instruction: e.target.value } : x)))} />
                  <input className="input w-20" type="number" placeholder="seg" value={s.duration} onChange={(e) => setSteps((a) => a.map((x, j) => (j === idx ? { ...x, duration: e.target.value } : x)))} />
                  {steps.length > 1 && <button type="button" className="btn-ghost btn-sm" onClick={() => setSteps((a) => a.filter((_, j) => j !== idx))}>✕</button>}
                </div>
              ))}
            </div>
          </div>
          <div><label className="label">Legenda</label><textarea className="textarea" rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
          <div className="flex gap-2">
            <div className="flex-1"><label className="label">Hashtags</label><input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="promoção novidade" /></div>
            <div className="w-24"><label className="label">Duração (s)</label><input className="input" type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
