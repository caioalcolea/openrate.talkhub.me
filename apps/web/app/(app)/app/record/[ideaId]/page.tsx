'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
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
  target_duration_seconds: number;
}

function RecordScreen() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const productId = useSearchParams().get('product') ?? '';
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<Recorder | null>(null);

  const [idea, setIdea] = useState<Idea | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // select() devolve a ideia (com o roteiro) e conta o uso.
    void api<Idea>(`/v1/ideas/${ideaId}/select`, { method: 'POST' }).then(setIdea).catch((e) => setError(String(e)));
  }, [ideaId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

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
    } catch {
      setError('Não foi possível acessar a câmera/microfone. Verifique as permissões do navegador.');
    }
  }

  async function finish() {
    const rec = recRef.current;
    if (!rec) return;
    const { blob, contentType } = await rec.stop();
    setRecording(false);
    await putPending({
      id: crypto.randomUUID(),
      ideaId,
      productId,
      contentType,
      blob,
      createdAt: Date.now(),
    });
    router.push('/app/upload');
  }

  const steps = idea?.script ?? [];
  const current = steps[stepIdx];
  const target = idea?.target_duration_seconds ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="h-[60vh] w-full object-cover" />
        {/* Overlay-guia (teleprompter): passo atual do roteiro */}
        <div className="absolute inset-x-0 bottom-0 bg-black/50 p-3 text-white">
          <p className="text-xs opacity-70">
            {idea?.hook} · {recording ? `${elapsed}s` : 'pronto'} / {target}s
          </p>
          <p className="mt-1 text-sm font-medium">
            {current ? `Passo ${current.step}: ${current.instruction}` : 'Sem roteiro'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button className="btn bg-neutral-600" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>
          ◀ Passo
        </button>
        <span className="text-sm text-neutral-500">
          {steps.length ? `${stepIdx + 1}/${steps.length}` : '—'}
        </span>
        <button
          className="btn bg-neutral-600"
          onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={stepIdx >= steps.length - 1}
        >
          Passo ▶
        </button>
      </div>

      {!recording ? (
        <button className="btn" onClick={begin}>● Gravar</button>
      ) : (
        <button className="btn bg-red-600" onClick={finish}>■ Parar e salvar</button>
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
