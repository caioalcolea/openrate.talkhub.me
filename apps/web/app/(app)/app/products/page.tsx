'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';

interface Product {
  id: string;
  name: string;
}
interface Idea {
  id: string;
  hook: string;
  target_duration_seconds: number;
}

export default function AppProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);

  useEffect(() => {
    void api<Product[]>('/v1/products').then(setProducts);
  }, []);

  async function openProduct(id: string) {
    setSelected(id);
    setIdeas(await api<Idea[]>(`/v1/products/${id}/ideas`));
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Produtos</h1>
      {products.map((p) => (
        <button key={p.id} className="card text-left" onClick={() => openProduct(p.id)}>
          {p.name}
        </button>
      ))}
      {selected && (
        <>
          <h2 className="mt-3 font-semibold">Ideias</h2>
          {ideas.map((i) => (
            <Link key={i.id} href={`/app/record/${i.id}?product=${selected}`} className="card block">
              <p className="font-medium">{i.hook}</p>
              <p className="text-xs text-neutral-500">Gravar · alvo {i.target_duration_seconds}s →</p>
            </Link>
          ))}
          {ideas.length === 0 && <p className="text-neutral-500">Sem ideias — peça ao gerente para gerar.</p>}
        </>
      )}
    </div>
  );
}
