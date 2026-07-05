'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';

interface Brand {
  id: string;
  name: string;
  logo_key: string | null;
  logoUrl: string | null;
}
interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}
interface VideoType {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  default_duration_seconds: number | null;
  organization_id: string | null;
}
type Step = { step: number; action: string; speech: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function uploadImage(file: File, kind: 'brand-logo' | 'product-image'): Promise<string> {
  const { key, url } = await api<{ key: string; url: string }>('/v1/media/upload-url', {
    method: 'POST',
    body: { kind, contentType: file.type },
  });
  const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error('falha ao enviar a imagem');
  return key;
}

export default function CatalogPage() {
  const toast = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [vts, setVts] = useState<VideoType[]>([]);

  // forms
  const [brandName, setBrandName] = useState('');
  const [brandFile, setBrandFile] = useState<File | null>(null);
  const [catName, setCatName] = useState('');
  const [catParent, setCatParent] = useState('');
  const [vtName, setVtName] = useState('');
  const [vtIcon, setVtIcon] = useState('');
  const [vtDur, setVtDur] = useState('');
  const [vtPrompt, setVtPrompt] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState('');

  const err = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  async function load() {
    try {
      const [b, c, v] = await Promise.all([
        api<Brand[]>('/v1/brands'),
        api<Category[]>('/v1/categories'),
        api<VideoType[]>('/v1/video-types'),
      ]);
      setBrands(b);
      setCats(c);
      setVts(v);
    } catch (e) {
      err(e);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    setBusy('brand');
    try {
      const logoKey = brandFile ? await uploadImage(brandFile, 'brand-logo') : undefined;
      await api('/v1/brands', { method: 'POST', body: { name: brandName, logoKey } });
      toast.success('Marca criada.');
      setBrandName('');
      setBrandFile(null);
      await load();
    } catch (e) {
      err(e);
    } finally {
      setBusy('');
    }
  }

  async function createCat(e: React.FormEvent) {
    e.preventDefault();
    setBusy('cat');
    try {
      await api('/v1/categories', {
        method: 'POST',
        body: { name: catName, slug: slugify(catName), parentId: catParent || undefined },
      });
      toast.success('Categoria criada.');
      setCatName('');
      setCatParent('');
      await load();
    } catch (e) {
      err(e);
    } finally {
      setBusy('');
    }
  }

  async function createVt(e: React.FormEvent) {
    e.preventDefault();
    setBusy('vt');
    try {
      const scriptSkeleton = steps
        .filter((s) => s.action.trim())
        .map((s, i) => ({ step: i + 1, action: s.action.trim(), speech: s.speech.trim() || undefined }));
      await api('/v1/video-types', {
        method: 'POST',
        body: {
          name: vtName,
          slug: slugify(vtName),
          icon: vtIcon || undefined,
          promptTemplate: vtPrompt || undefined,
          defaultDurationSeconds: vtDur ? Number(vtDur) : undefined,
          scriptSkeleton: scriptSkeleton.length ? scriptSkeleton : undefined,
        },
      });
      toast.success('Tipo de vídeo criado.');
      setVtName('');
      setVtIcon('');
      setVtDur('');
      setVtPrompt('');
      setSteps([]);
      await load();
    } catch (e) {
      err(e);
    } finally {
      setBusy('');
    }
  }

  const catName_ = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;

  return (
    <div className="space-y-6">
      <h1>Catálogo</h1>

      {/* Marcas */}
      <section className="space-y-3">
        <h2 className="font-semibold">Marcas</h2>
        <form onSubmit={createBrand} className="card flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label className="label">Nome da marca</label>
            <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Logo</label>
            <input className="input" type="file" accept="image/*" onChange={(e) => setBrandFile(e.target.files?.[0] ?? null)} />
          </div>
          <button className="btn" disabled={busy === 'brand' || !brandName}>
            {busy === 'brand' ? 'Salvando…' : 'Adicionar marca'}
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <span key={b.id} className="badge badge-neutral flex items-center gap-2">
              {b.logoUrl && <img src={b.logoUrl} alt="" className="h-4 w-4 rounded object-cover" />}
              {b.name}
            </span>
          ))}
          {brands.length === 0 && <span className="text-sm text-neutral-500">Nenhuma marca.</span>}
        </div>
      </section>

      {/* Categorias */}
      <section className="space-y-3">
        <h2 className="font-semibold">Categorias</h2>
        <form onSubmit={createCat} className="card flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label className="label">Nome</label>
            <input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} required />
          </div>
          <div className="min-w-[10rem]">
            <label className="label">Categoria-pai (opcional)</label>
            <select className="select" value={catParent} onChange={(e) => setCatParent(e.target.value)}>
              <option value="">— nenhuma —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" disabled={busy === 'cat' || !catName}>Adicionar categoria</button>
        </form>
        <div className="space-y-1">
          {cats.map((c) => (
            <div key={c.id} className="text-sm">
              {c.name}
              {c.parent_id && <span className="text-neutral-400"> · em {catName_(c.parent_id)}</span>}
            </div>
          ))}
          {cats.length === 0 && <span className="text-sm text-neutral-500">Nenhuma categoria.</span>}
        </div>
      </section>

      {/* Tipos de vídeo */}
      <section className="space-y-3">
        <h2 className="font-semibold">Tipos de vídeo</h2>
        <form onSubmit={createVt} className="card space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[10rem]">
              <label className="label">Nome</label>
              <input className="input" value={vtName} onChange={(e) => setVtName(e.target.value)} required />
            </div>
            <div className="w-20">
              <label className="label">Ícone</label>
              <input className="input" value={vtIcon} onChange={(e) => setVtIcon(e.target.value)} placeholder="🎬" maxLength={4} />
            </div>
            <div className="w-32">
              <label className="label">Duração (s)</label>
              <input className="input" type="number" min="1" value={vtDur} onChange={(e) => setVtDur(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Prompt para a IA (opcional)</label>
            <textarea className="textarea" rows={2} value={vtPrompt} onChange={(e) => setVtPrompt(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Roteiro padrão (passos)</label>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSteps((s) => [...s, { step: s.length + 1, action: '', speech: '' }])}>
                + passo
              </button>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Ação"
                    value={s.action}
                    onChange={(e) => setSteps((arr) => arr.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))}
                  />
                  <input
                    className="input flex-1"
                    placeholder="Fala (opcional)"
                    value={s.speech}
                    onChange={(e) => setSteps((arr) => arr.map((x, j) => (j === i ? { ...x, speech: e.target.value } : x)))}
                  />
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setSteps((arr) => arr.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button className="btn" disabled={busy === 'vt' || !vtName}>Adicionar tipo de vídeo</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {vts.map((v) => (
            <span key={v.id} className="badge badge-neutral">
              {v.icon ? `${v.icon} ` : ''}
              {v.name}
              {v.organization_id === null && <span className="ml-1 text-neutral-400">(global)</span>}
            </span>
          ))}
          {vts.length === 0 && <span className="text-sm text-neutral-500">Nenhum tipo.</span>}
        </div>
      </section>
    </div>
  );
}
