'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl } from '../../../lib/format';
import { useListControls, Pager } from '../../../components/list-controls';

interface Product {
  id: string;
  name: string;
  scope: string;
  price: number | null;
  sku: string | null;
  active: boolean;
  thumbUrl: string | null;
}
interface Ref {
  id: string;
  name: string;
}

const SCOPE_LABELS: Record<string, string> = { store: 'Loja', organization: 'Organização', platform: 'Plataforma' };

export default function ProductsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Product[] | null>(null);
  const [stores, setStores] = useState<Ref[]>([]);
  const [storeId, setStoreId] = useState('');
  const [scope, setScope] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    try {
      const params = new URLSearchParams();
      if (storeId) params.set('storeId', storeId);
      if (scope) params.set('scope', scope);
      if (q.trim()) params.set('q', q.trim());
      setItems(await api<Product[]>(`/v1/products${params.toString() ? `?${params}` : ''}`));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    api<Ref[]>('/v1/stores').then(setStores).catch(() => setStores([]));
  }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, scope]);

  // Busca/filtros são server-side; aqui só paginamos o resultado já carregado.
  const { page, setPage, pageItems, total, totalPages } = useListControls<Product>(items ?? [], undefined, 12);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1>Produtos</h1>
        <Link href="/products/new" className="btn">Novo produto</Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Buscar (nome ou SKU)</label>
          <form onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enter para buscar" />
          </form>
        </div>
        <div className="min-w-[10rem]">
          <label className="label">Loja</label>
          <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Todas</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[9rem]">
          <label className="label">Escopo</label>
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Todos</option>
            <option value="store">Loja</option>
            <option value="organization">Organização</option>
            <option value="platform">Plataforma</option>
          </select>
        </div>
      </div>

      {items === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">📦</span>
          Nenhum produto. Clique em “Novo produto” para cadastrar.
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pageItems.map((p) => (
            <div key={p.id} className="card flex items-center gap-3">
              {p.thumbUrl ? (
                <img src={p.thumbUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-lg">📦</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-sm text-neutral-500">
                  <span className="badge badge-neutral">{SCOPE_LABELS[p.scope] ?? p.scope}</span>{' '}
                  {p.price != null ? brl(p.price) : '—'}
                  {!p.active && <span className="ml-1 text-neutral-400">· inativo</span>}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link className="btn-ghost btn-sm" href={`/products/${p.id}/edit`}>Editar</Link>
                <Link className="btn-ghost btn-sm" href={`/products/${p.id}/ideas`}>Ideias</Link>
              </div>
            </div>
          ))}
        </div>
        <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
