'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { useAuth } from '../../../../../lib/auth';
import { createRecorder, type Recorder } from '../../../../../lib/recording';
import { putPending } from '../../../../../lib/idb';

interface Step {
  step: number;
  instruction: string;
  durationSeconds?: number;
}
interface Idea {
  id: string;
  hook: string;
  script: Step[];
  target_duration_seconds: number | null;
}
type Mode = 'teleprompter' | 'checklist';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function RecordScreen() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const productId = useSearchParams().get('product') ?? '';
  const router = useRouter();
  const { me } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<Recorder | null>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const [idea, setIdea] = useState<Idea | null>(null);
  const [mode, setMode] = useState<Mode>('teleprompter');
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Idea>(`/v1/ideas/${ideaId}/select`, { method: 'POST' }).then(setIdea).catch((e) => setError(String(e)));
  }, [ideaId]);

  const steps = useMemo(() => idea?.script ?? [], [idea]);
  const target = idea?.target_duration_seconds ?? 0;

  // Janela de tempo de cada passo (teleprompter): usa durationSeconds ou reparte o
  // alvo igualmente (fallback 6s). starts[i] = início acumulado do passo i.
  const starts = useMemo(() => {
    const fallback = target > 0 && steps.length > 0 ? Math.max(3, Math.round(target / steps.length)) : 6;
    const durs = steps.map((s) => s.durationSeconds || fallback);
    const acc: number[] = [];
    let sum = 0;
    for (const d of durs) {
      acc.push(sum);
      sum += d;
    }
    return acc;
  }, [steps, target]);

  // Cronômetro.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Teleprompter: auto-avança conforme o tempo decorrido.
  useEffect(() => {
    if (!recording || mode !== 'teleprompter' || steps.length === 0) return;
    let i = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k] <= elapsed) i = k;
    setStepIdx(i);
  }, [elapsed, recording, mode, starts, steps.length]);

  // Rola o passo ativo para o centro.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [stepIdx]);

  const activeIdx = mode === 'checklist' ? steps.findIndex((s) => !done.has(s.step)) : stepIdx;

  async function begin() {
    try {
      const rec = await createRecorder();
      recRef.current = rec;
      if (videoRef.current) {
        videoRef.current.srcObject = rec.stream;
        await videoRef.current.play().catch(() => undefined);
      }
      rec.start();
      setRecording(true);
      setElapsed(0);
      setStepIdx(0);
    } catch {
      setError('Não foi possível acessar a câmera/microfone. Verifique as permissões do navegador.');
    }
  }

  async function finish() {
    const rec = recRef.current;
    if (!rec) return;
    const { blob, contentType } = await rec.stop();
    setRecording(false);
    await putPending({ id: crypto.randomUUID(), ideaId, productId, contentType, blob, createdAt: Date.now() });
    router.push('/app/upload');
  }

  const overTarget = target > 0 && elapsed > target;
  const current = steps[activeIdx];

  // Gate de cessão de imagem: sem assinar, não libera a gravação (a API também bloqueia).
  if (me && me.user.image_release_status !== 'signed') {
    return (
      <div className="card space-y-3 text-center">
        <span className="text-3xl">📝</span>
        <h1 className="text-lg font-bold">Assine a cessão de imagem</h1>
        <p className="text-sm text-neutral-600">
          Antes de gravar, você precisa autorizar o uso da sua imagem nos vídeos.
        </p>
        <Link href="/app/image-release" className="btn">Assinar agora</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="h-[52vh] w-full object-cover" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2 text-white">
          <span className="rounded bg-black/50 px-2 py-0.5 text-xs">{idea?.hook ?? '…'}</span>
          <span className={'rounded px-2 py-0.5 text-sm font-semibold ' + (overTarget ? 'bg-red-600' : 'bg-black/50')}>
            {fmt(elapsed)}{target ? ` / ${fmt(target)}` : ''}
          </span>
        </div>
        {current && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-white">
            <p className="text-xs opacity-70">Passo {current.step} de {steps.length}</p>
            <p className="mt-0.5 text-base font-semibold">{current.instruction}</p>
          </div>
        )}
      </div>

      {/* Modo */}
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
        {(['teleprompter', 'checklist'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={'flex-1 rounded-md py-1.5 ' + (mode === m ? 'bg-white font-medium shadow-sm' : 'text-neutral-500')}
          >
            {m === 'teleprompter' ? 'Teleprompter' : 'Checklist'}
          </button>
        ))}
      </div>

      {/* Roteiro */}
      <ol className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2">
        {steps.map((s, i) => {
          const isDone = done.has(s.step);
          const isActive = i === activeIdx;
          return (
            <li
              key={s.step}
              ref={isActive ? activeRef : null}
              onClick={() =>
                mode === 'checklist' &&
                setDone((d) => {
                  const n = new Set(d);
                  n.has(s.step) ? n.delete(s.step) : n.add(s.step);
                  return n;
                })
              }
              className={
                'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ' +
                (mode === 'checklist' ? 'cursor-pointer ' : '') +
                (isActive ? 'bg-brand/10 ' : '') +
                (isDone ? 'text-neutral-400 line-through' : '')
              }
            >
              <span className="mt-0.5 text-xs text-neutral-400">{mode === 'checklist' ? (isDone ? '☑' : '☐') : s.step}</span>
              <span className="flex-1">{s.instruction}</span>
              {s.durationSeconds ? <span className="text-xs text-neutral-400">{s.durationSeconds}s</span> : null}
            </li>
          );
        })}
        {steps.length === 0 && <li className="p-2 text-sm text-neutral-500">Sem roteiro nesta ideia.</li>}
      </ol>

      {!recording ? (
        <button className="btn" onClick={begin}>● Gravar</button>
      ) : (
        <button className="btn-danger" onClick={finish}>■ Parar e salvar</button>
      )}
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense fallback={<p className="text-neutral-500">Carregando…</p>}>
      <RecordScreen />
    </Suspense>
  );
}
