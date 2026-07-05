'use client';
import { useState } from 'react';

// Busca + paginação client-side para listas já carregadas (o MVP traz listas
// capadas em ~200-500 linhas, então filtrar/paginar em memória é instantâneo e
// evita reescrever a resposta de cada endpoint). `search` recebe o item e a
// query já em minúsculas; retorne true para manter.
export function useListControls<T>(
  items: T[],
  search?: (item: T, q: string) => boolean,
  pageSize = 20,
) {
  const [query, setQueryRaw] = useState('');
  const [page, setPage] = useState(1);

  const q = query.trim().toLowerCase();
  const filtered = q && search ? items.filter((it) => search(it, q)) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    query,
    setQuery: (v: string) => {
      setQueryRaw(v);
      setPage(1); // toda nova busca volta à primeira página
    },
    page: safePage,
    setPage,
    pageItems,
    total: filtered.length,
    totalPages,
  };
}

// Controles de página (esconde-se quando há uma página só).
export function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2 text-sm">
      <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span className="text-neutral-500">
        Página {page} de {totalPages}
        {typeof total === 'number' ? ` · ${total} itens` : ''}
      </span>
      <button className="btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </div>
  );
}
