'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from './toast';
import {
  PRODUCT_TYPES,
  PRODUCT_UNITS,
  type ProductScope,
  type ProductType,
  type ProductUnit,
} from '@openrate/shared';

interface Ref {
  id: string;
  name: string;
}
interface ImageRow {
  id: string;
  url: string;
  is_primary: boolean;
}
interface VariationRow {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
}
interface InventoryRow {
  id: string;
  store_id: string;
  store_name: string;
  quantity: number;
  price_override: string | null;
}

const EMPTY = {
  name: '', model: '', productType: 'simple' as ProductType, scope: 'store' as ProductScope,
  storeId: '', brandId: '', categoryId: '', sku: '', gtin: '', unit: '' as ProductUnit | '',
  ncm: '', cest: '', fiscalOrigin: '',
  price: '', promoPrice: '', costPrice: '',
  shortDescription: '', description: '', tags: '', seoTitle: '', seoDescription: '', institutionalVideoUrl: '',
  weightGrossKg: '', weightNetKg: '', heightCm: '', widthCm: '', lengthCm: '', itemsPerBox: '',
};

const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));
const str = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

const TABS_BASE = ['Identificação', 'Fiscal', 'Preços', 'Descrição', 'Logística'] as const;
const TABS_EDIT = ['Mídia', 'Variações', 'Estoque'] as const;

async function uploadImage(file: File): Promise<string> {
  const { key, url } = await api<{ key: string; url: string }>('/v1/media/upload-url', {
    method: 'POST',
    body: { kind: 'product-image', contentType: file.type },
  });
  const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error('falha ao enviar imagem');
  return key;
}

export function ProductForm({ mode, productId }: { mode: 'new' | 'edit'; productId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';

  const [tab, setTab] = useState<string>('Identificação');
  const [f, setF] = useState({ ...EMPTY });
  const [brands, setBrands] = useState<Ref[]>([]);
  const [cats, setCats] = useState<Ref[]>([]);
  const [stores, setStores] = useState<Ref[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [variations, setVariations] = useState<VariationRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  useEffect(() => {
    void (async () => {
      try {
        const [b, c, s] = await Promise.all([
          api<Ref[]>('/v1/brands'),
          api<Ref[]>('/v1/categories'),
          api<Ref[]>('/v1/stores'),
        ]);
        setBrands(b);
        setCats(c);
        setStores(s);
      } catch (e) {
        errToast(e);
      }
      if (mode === 'edit' && productId) await loadProduct();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, productId]);

  async function loadProduct() {
    if (!productId) return;
    try {
      const d = await api<{ product: Record<string, unknown>; images: ImageRow[]; variations: VariationRow[]; inventory: InventoryRow[] }>(
        `/v1/products/${productId}`,
      );
      const p = d.product as Record<string, string | number | string[] | null>;
      setF({
        name: (p.name as string) ?? '', model: (p.model as string) ?? '',
        productType: ((p.product_type as ProductType) ?? 'simple'), scope: ((p.scope as ProductScope) ?? 'store'),
        storeId: (p.store_id as string) ?? '', brandId: (p.brand_id as string) ?? '', categoryId: (p.category_id as string) ?? '',
        sku: (p.sku as string) ?? '', gtin: (p.gtin as string) ?? '', unit: ((p.unit as ProductUnit) ?? ''),
        ncm: (p.ncm as string) ?? '', cest: (p.cest as string) ?? '', fiscalOrigin: (p.fiscal_origin as string) ?? '',
        price: p.price != null ? String(p.price) : '', promoPrice: p.promo_price != null ? String(p.promo_price) : '',
        costPrice: p.cost_price != null ? String(p.cost_price) : '',
        shortDescription: (p.short_description as string) ?? '', description: (p.description as string) ?? '',
        tags: Array.isArray(p.tags) ? (p.tags as string[]).join(', ') : '',
        seoTitle: (p.seo_title as string) ?? '', seoDescription: (p.seo_description as string) ?? '',
        institutionalVideoUrl: (p.institutional_video_url as string) ?? '',
        weightGrossKg: p.weight_gross_kg != null ? String(p.weight_gross_kg) : '',
        weightNetKg: p.weight_net_kg != null ? String(p.weight_net_kg) : '',
        heightCm: p.height_cm != null ? String(p.height_cm) : '', widthCm: p.width_cm != null ? String(p.width_cm) : '',
        lengthCm: p.length_cm != null ? String(p.length_cm) : '', itemsPerBox: p.items_per_box != null ? String(p.items_per_box) : '',
      });
      setImages(d.images);
      setVariations(d.variations);
      setInventory(d.inventory);
    } catch (e) {
      errToast(e);
    }
  }

  function buildBody() {
    const tags = f.tags.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      name: f.name, scope: f.scope, origin: 'manual',
      model: str(f.model), productType: f.productType,
      storeId: f.scope === 'store' ? str(f.storeId) : undefined,
      brandId: str(f.brandId), categoryId: str(f.categoryId),
      sku: str(f.sku), gtin: str(f.gtin), unit: f.unit || undefined,
      ncm: str(f.ncm), cest: str(f.cest), fiscalOrigin: str(f.fiscalOrigin),
      price: num(f.price), promoPrice: num(f.promoPrice), costPrice: num(f.costPrice),
      shortDescription: str(f.shortDescription), description: str(f.description),
      tags: tags.length ? tags : undefined,
      seoTitle: str(f.seoTitle), seoDescription: str(f.seoDescription), institutionalVideoUrl: str(f.institutionalVideoUrl),
      weightGrossKg: num(f.weightGrossKg), weightNetKg: num(f.weightNetKg),
      heightCm: num(f.heightCm), widthCm: num(f.widthCm), lengthCm: num(f.lengthCm), itemsPerBox: num(f.itemsPerBox),
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.scope === 'store' && !f.storeId) {
      setTab('Identificação');
      return toast.error('Selecione uma loja para produto de escopo "loja".');
    }
    setBusy(true);
    try {
      if (mode === 'new') {
        const p = await api<{ id: string }>('/v1/products', { method: 'POST', body: buildBody() });
        toast.success('Produto criado. Agora adicione imagens, variações e estoque.');
        router.push(`/products/${p.id}/edit`);
      } else {
        await api(`/v1/products/${productId}`, { method: 'PATCH', body: buildBody() });
        toast.success('Produto salvo.');
      }
    } catch (e) {
      errToast(e);
    } finally {
      setBusy(false);
    }
  }

  // --- mídia ---
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      try {
        const storageKey = await uploadImage(file);
        await api(`/v1/products/${productId}/images`, {
          method: 'POST',
          body: { storageKey, isPrimary: images.length === 0 },
        });
      } catch (err) {
        errToast(err);
      }
    }
    await loadProduct();
  }
  async function setPrimary(imageId: string) {
    await api(`/v1/products/${productId}/images/${imageId}/primary`, { method: 'POST' }).catch(errToast);
    await loadProduct();
  }
  async function delImage(imageId: string) {
    await api(`/v1/products/${productId}/images/${imageId}`, { method: 'DELETE' }).catch(errToast);
    await loadProduct();
  }

  // --- variações ---
  const [vName, setVName] = useState('');
  const [vSku, setVSku] = useState('');
  const [vPrice, setVPrice] = useState('');
  async function addVariation() {
    if (!vName.trim()) return;
    try {
      await api(`/v1/products/${productId}/variations`, {
        method: 'POST',
        body: { name: vName, sku: str(vSku), price: num(vPrice) },
      });
      setVName('');
      setVSku('');
      setVPrice('');
      await loadProduct();
    } catch (e) {
      errToast(e);
    }
  }
  async function delVariation(vid: string) {
    await api(`/v1/products/${productId}/variations/${vid}`, { method: 'DELETE' }).catch(errToast);
    await loadProduct();
  }

  // --- estoque ---
  const [invStore, setInvStore] = useState('');
  const [invQty, setInvQty] = useState('');
  const [invPrice, setInvPrice] = useState('');
  async function saveInventory() {
    if (!invStore) return toast.error('Escolha a loja.');
    try {
      await api(`/v1/products/${productId}/inventory`, {
        method: 'POST',
        body: { storeId: invStore, productId, quantity: Number(invQty || 0), priceOverride: num(invPrice) },
      });
      setInvStore('');
      setInvQty('');
      setInvPrice('');
      await loadProduct();
    } catch (e) {
      errToast(e);
    }
  }

  const tabs = mode === 'edit' ? [...TABS_BASE, ...TABS_EDIT] : [...TABS_BASE];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{mode === 'new' ? 'Novo produto' : 'Editar produto'}</h1>
        <button className="btn" disabled={busy || !f.name} onClick={save}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {tabs.map((tName) => (
          <button
            key={tName}
            onClick={() => setTab(tName)}
            className={
              'rounded-t-lg px-3 py-2 text-sm ' +
              (tab === tName ? 'border-b-2 border-brand font-medium text-brand' : 'text-neutral-500')
            }
          >
            {tName}
          </button>
        ))}
      </div>

      <form onSubmit={save} className="card space-y-3">
        {tab === 'Identificação' && (
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[14rem]">
              <label className="label">Nome</label>
              <input className="input" value={f.name} onChange={set('name')} required />
            </div>
            <div className="min-w-[9rem]">
              <label className="label">Escopo</label>
              <select className="select" value={f.scope} onChange={set('scope')}>
                <option value="store">Loja</option>
                <option value="organization">Organização</option>
                {isSuper && <option value="platform">Plataforma (global)</option>}
              </select>
            </div>
            {f.scope === 'store' && (
              <div className="min-w-[10rem]">
                <label className="label">Loja</label>
                <select className="select" value={f.storeId} onChange={set('storeId')} required>
                  <option value="">— selecione —</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="min-w-[9rem]">
              <label className="label">Tipo</label>
              <select className="select" value={f.productType} onChange={set('productType')}>
                {PRODUCT_TYPES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[8rem]">
              <label className="label">SKU</label>
              <input className="input" value={f.sku} onChange={set('sku')} />
            </div>
            <div className="min-w-[8rem]">
              <label className="label">GTIN/EAN</label>
              <input className="input" value={f.gtin} onChange={set('gtin')} />
            </div>
            <div className="min-w-[7rem]">
              <label className="label">Unidade</label>
              <select className="select" value={f.unit} onChange={set('unit')}>
                <option value="">—</option>
                {PRODUCT_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[9rem]">
              <label className="label">Marca</label>
              <select className="select" value={f.brandId} onChange={set('brandId')}>
                <option value="">—</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[9rem]">
              <label className="label">Categoria</label>
              <select className="select" value={f.categoryId} onChange={set('categoryId')}>
                <option value="">—</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[9rem]">
              <label className="label">Modelo</label>
              <input className="input" value={f.model} onChange={set('model')} />
            </div>
          </div>
        )}

        {tab === 'Fiscal' && (
          <div className="flex flex-wrap gap-3">
            <div><label className="label">NCM</label><input className="input w-40" value={f.ncm} onChange={set('ncm')} placeholder="0000.00.00" /></div>
            <div><label className="label">CEST</label><input className="input w-40" value={f.cest} onChange={set('cest')} /></div>
            <div><label className="label">Origem fiscal (0-8)</label><input className="input w-32" value={f.fiscalOrigin} onChange={set('fiscalOrigin')} maxLength={1} /></div>
          </div>
        )}

        {tab === 'Preços' && (
          <div className="flex flex-wrap gap-3">
            <div><label className="label">Preço (R$)</label><input className="input w-36" type="number" step="0.01" value={f.price} onChange={set('price')} /></div>
            <div><label className="label">Promocional</label><input className="input w-36" type="number" step="0.01" value={f.promoPrice} onChange={set('promoPrice')} /></div>
            <div><label className="label">Custo</label><input className="input w-36" type="number" step="0.01" value={f.costPrice} onChange={set('costPrice')} /></div>
          </div>
        )}

        {tab === 'Descrição' && (
          <div className="space-y-3">
            <div><label className="label">Descrição curta</label><input className="input" value={f.shortDescription} onChange={set('shortDescription')} /></div>
            <div><label className="label">Descrição completa</label><textarea className="textarea" rows={5} value={f.description} onChange={set('description')} /></div>
            <div><label className="label">Tags (separadas por vírgula)</label><input className="input" value={f.tags} onChange={set('tags')} placeholder="promoção, novidade" /></div>
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[12rem]"><label className="label">SEO título</label><input className="input" value={f.seoTitle} onChange={set('seoTitle')} /></div>
              <div className="flex-1 min-w-[12rem]"><label className="label">SEO descrição</label><input className="input" value={f.seoDescription} onChange={set('seoDescription')} /></div>
            </div>
            <div><label className="label">Vídeo institucional (URL)</label><input className="input" value={f.institutionalVideoUrl} onChange={set('institutionalVideoUrl')} placeholder="https://…" /></div>
          </div>
        )}

        {tab === 'Logística' && (
          <div className="flex flex-wrap gap-3">
            <div><label className="label">Peso bruto (kg)</label><input className="input w-32" type="number" step="0.001" value={f.weightGrossKg} onChange={set('weightGrossKg')} /></div>
            <div><label className="label">Peso líquido (kg)</label><input className="input w-32" type="number" step="0.001" value={f.weightNetKg} onChange={set('weightNetKg')} /></div>
            <div><label className="label">Altura (cm)</label><input className="input w-28" type="number" step="0.01" value={f.heightCm} onChange={set('heightCm')} /></div>
            <div><label className="label">Largura (cm)</label><input className="input w-28" type="number" step="0.01" value={f.widthCm} onChange={set('widthCm')} /></div>
            <div><label className="label">Compr. (cm)</label><input className="input w-28" type="number" step="0.01" value={f.lengthCm} onChange={set('lengthCm')} /></div>
            <div><label className="label">Itens/caixa</label><input className="input w-28" type="number" value={f.itemsPerBox} onChange={set('itemsPerBox')} /></div>
          </div>
        )}

        {tab === 'Mídia' && mode === 'edit' && (
          <div className="space-y-3">
            <input type="file" accept="image/*" multiple onChange={onFiles} className="input" />
            <div className="flex flex-wrap gap-3">
              {images.map((im) => (
                <div key={im.id} className="w-28 space-y-1">
                  <img src={im.url} alt="" className="h-28 w-28 rounded-lg border object-cover" />
                  <div className="flex justify-between text-xs">
                    <button type="button" className={im.is_primary ? 'text-brand' : 'text-neutral-500'} onClick={() => setPrimary(im.id)}>
                      {im.is_primary ? '★ principal' : 'tornar principal'}
                    </button>
                    <button type="button" className="text-red-500" onClick={() => delImage(im.id)}>✕</button>
                  </div>
                </div>
              ))}
              {images.length === 0 && <p className="text-sm text-neutral-500">Nenhuma imagem.</p>}
            </div>
          </div>
        )}

        {tab === 'Variações' && mode === 'edit' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[10rem]"><label className="label">Nome da variação</label><input className="input" value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Ex.: Sabor morango" /></div>
              <div><label className="label">SKU</label><input className="input w-28" value={vSku} onChange={(e) => setVSku(e.target.value)} /></div>
              <div><label className="label">Preço</label><input className="input w-28" type="number" step="0.01" value={vPrice} onChange={(e) => setVPrice(e.target.value)} /></div>
              <button type="button" className="btn-ghost" onClick={addVariation}>Adicionar</button>
            </div>
            <div className="space-y-1">
              {variations.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm">
                  <span>{v.name}{v.sku ? ` · ${v.sku}` : ''}{v.price ? ` · R$ ${v.price}` : ''}</span>
                  <button type="button" className="text-red-500" onClick={() => delVariation(v.id)}>remover</button>
                </div>
              ))}
              {variations.length === 0 && <p className="text-sm text-neutral-500">Nenhuma variação.</p>}
            </div>
          </div>
        )}

        {tab === 'Estoque' && mode === 'edit' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem]">
                <label className="label">Loja</label>
                <select className="select" value={invStore} onChange={(e) => setInvStore(e.target.value)}>
                  <option value="">— selecione —</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div><label className="label">Quantidade</label><input className="input w-28" type="number" value={invQty} onChange={(e) => setInvQty(e.target.value)} /></div>
              <div><label className="label">Preço local</label><input className="input w-28" type="number" step="0.01" value={invPrice} onChange={(e) => setInvPrice(e.target.value)} /></div>
              <button type="button" className="btn-ghost" onClick={saveInventory}>Salvar estoque</button>
            </div>
            <div className="space-y-1">
              {inventory.map((r) => (
                <div key={r.id} className="text-sm">
                  {r.store_name}: <b>{r.quantity}</b> un.{r.price_override ? ` · R$ ${r.price_override}` : ''}
                </div>
              ))}
              {inventory.length === 0 && <p className="text-sm text-neutral-500">Sem estoque cadastrado.</p>}
            </div>
          </div>
        )}
      </form>

      {mode === 'new' && (
        <p className="text-sm text-neutral-500">
          Imagens, variações e estoque ficam disponíveis após salvar o produto.
        </p>
      )}
    </div>
  );
}
