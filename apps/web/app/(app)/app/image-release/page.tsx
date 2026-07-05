'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { useToast } from '../../../../components/toast';

export default function ImageReleasePage() {
  const { me, reload } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const status = me?.user.image_release_status ?? 'pending';
  const signed = status === 'signed';
  const revoked = status === 'revoked';

  async function accept() {
    setBusy(true);
    try {
      await api('/v1/me/image-release/accept', { method: 'POST' });
      await reload();
      toast.success('Cessão de imagem assinada. Você já pode gravar!');
      router.push('/app/products');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Cessão de direito de imagem</h1>

      {signed ? (
        <div className="card space-y-2">
          <span className="badge badge-green">Assinada ✓</span>
          <p className="text-sm text-neutral-600">
            Você já autorizou o uso da sua imagem. Pode gravar e publicar seus vídeos normalmente.
          </p>
          <button className="btn w-fit" onClick={() => router.push('/app/products')}>
            Ir para produtos
          </button>
        </div>
      ) : revoked ? (
        <div className="card space-y-2">
          <span className="badge badge-red">Revogada</span>
          <p className="text-sm text-neutral-600">
            Sua cessão de imagem foi revogada. Procure o gestor da sua rede para regularizar antes de gravar.
          </p>
        </div>
      ) : (
        <>
          <div className="card max-h-[45vh] space-y-3 overflow-y-auto text-sm text-neutral-700">
            <p>
              Ao assinar, você autoriza a rede e a plataforma OpenRate a captar, editar, armazenar e
              divulgar a sua imagem e voz nos vídeos que você gravar, exclusivamente para fins de
              divulgação dos produtos das lojas participantes nas plataformas de vídeo (TikTok,
              Instagram, Shopee, Kwai, Mercado Livre, YouTube e afins).
            </p>
            <p>
              A autorização é gratuita e vigora enquanto os vídeos permanecerem publicados. Você pode
              solicitar a revogação a qualquer momento ao gestor da rede — os vídeos com a sua imagem
              serão despublicados.
            </p>
            <p>
              Esta cessão não gera vínculo empregatício e não transfere a titularidade dos direitos
              autorais do conteúdo, apenas autoriza o uso da imagem conforme descrito acima.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>Li e concordo com os termos da cessão de direito de imagem.</span>
          </label>

          <button className="btn w-full" disabled={!agreed || busy} onClick={accept}>
            {busy ? 'Registrando…' : 'Assinar cessão de imagem'}
          </button>
        </>
      )}
    </div>
  );
}
