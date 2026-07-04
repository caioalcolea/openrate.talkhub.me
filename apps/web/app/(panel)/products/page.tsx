'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import type { CreateProductInput } from '@openrate/shared';

interface Product {
  id: string;
  name: string;
  scope: string;
  price: number | null;
}

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await api<Product[]>('/v1/products'));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateProductInput = {
      name,
      scope: 'store',
      origin: 'manual',
      price: price ? Number(price) : undefined,
    };
    await api('/v1/products', { method: 'POST', body });
    setName('');
    setPrice('');
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Produtos</h1>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="text-sm text-neutral-500">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm text-neutral-500">Preço</label>
          <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <button className="btn" type="submit">Adicionar</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-neutral-500">{p.scope} · R$ {p.price ?? '—'}</p>
            </div>
            <Link className="text-brand text-sm" href={`/products/${p.id}/ideas`}>Ideias →</Link>
          </div>
        ))}
        {items.length === 0 && <p className="text-neutral-500">Nenhum produto ainda.</p>}
      </div>
    </div>
  );
}
