'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { dateTime } from '../../../lib/format';
import { useListControls, Pager } from '../../../components/list-controls';

interface Entry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_id: string | null;
  user_name: string | null;
  ip: string | null;
  created_at: string;
}

export default function AuditPage() {
  const toast = useToast();
  const [items, setItems] = useState<Entry[] | null>(null);

  async function load() {
    try {
      setItems(await api<Entry[]>('/v1/audit-log'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const { query, setQuery, page, setPage, pageItems, total, totalPages } = useListControls<Entry>(
    items ?? [],
    (a, q) =>
      a.action.toLowerCase().includes(q) ||
      (a.entity_type ?? '').toLowerCase().includes(q) ||
      (a.entity_id ?? '').toLowerCase().includes(q) ||
      (a.user_name ?? '').toLowerCase().includes(q),
    25,
  );

  return (
    <div className="space-y-4">
      <h1>Auditoria</h1>
      <p className="text-sm text-neutral-500">
        Registro automático de todas as ações que alteram dados (criação, edição, aprovação, pagamento…).
      </p>

      {items && items.length > 0 && (
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por ação, recurso, id ou usuário…"
        />
      )}

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="empty">
          <span className="text-2xl">🛡️</span>
          {items.length === 0 ? 'Nenhuma ação registrada ainda.' : 'Nenhum registro corresponde à busca.'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400">
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Ação</th>
                  <th className="py-2 pr-3">Recurso</th>
                  <th className="py-2 pr-3">Usuário</th>
                  <th className="py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((a) => (
                  <tr key={a.id} className="border-b border-neutral-100">
                    <td className="whitespace-nowrap py-2 pr-3 text-neutral-500">{dateTime(a.created_at)}</td>
                    <td className="py-2 pr-3">
                      <span className="badge badge-neutral font-mono">{a.action}</span>
                    </td>
                    <td className="py-2 pr-3 text-neutral-600">
                      {a.entity_type ?? '—'}
                      {a.entity_id && <span className="ml-1 font-mono text-xs text-neutral-400">{a.entity_id.slice(0, 8)}</span>}
                    </td>
                    <td className="py-2 pr-3 text-neutral-600">{a.user_name ?? '—'}</td>
                    <td className="py-2 font-mono text-xs text-neutral-400">{a.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
