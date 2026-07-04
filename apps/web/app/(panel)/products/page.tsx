'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl } from '../../../lib/format';
import type { CreateProductInput } from '@openrate/shared';

interface Product {
  id: string;
  name: string;
  scope: string;
  price: number | null;
}

export default function ProductsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Product[] | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setItems(await api<Product[]>('/v1/products'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: CreateProductInput = {
      name,
      scope: 'store',
      origin: 'manual',
      price: price ? Number(price) : undefined,
    };
    try {
      await api('/v1/products', { method: 'POST', body });
      toast.success('Produto adicionado.');
      setName('');
      setPrice('');
      await load();
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Produtos</h1>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Preço</label>
          <input className="input w-32" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy || !name}>Adicionar</button>
      </form>

      {items === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">📦</span>
          Nenhum produto ainda. Cadastre o primeiro acima para gerar ideias de vídeo.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <div key={p.id} className="card flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-sm text-neutral-500">
                  <span className="badge badge-neutral">{p.scope}</span>{' '}
                  {p.price != null ? brl(p.price) : '—'}
                </p>
              </div>
              <Link className="btn-ghost btn-sm shrink-0" href={`/products/${p.id}/ideas`}>Ideias →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
