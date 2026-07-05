'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { brl, dateTime } from '../../../lib/format';
import type { CreateStoreSaleInput } from '@openrate/shared';

interface Sale {
  id: string;
  total_amount: string;
  occurred_at: string;
  store_name: string;
  customer_name: string | null;
  user_name: string | null;
}
interface Ref {
  id: string;
  name: string;
}
interface UserRef {
  id: string;
  full_name: string;
}
type Item = { name: string; quantity: string; price: string };

export default function StoreSalesPage() {
  const toast = useToast();
  const [items, setItems] = useState<Sale[] | null>(null);
  const [stores, setStores] = useState<Ref[]>([]);
  const [customers, setCustomers] = useState<Ref[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [userId, setUserId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [total, setTotal] = useState('');
  const [rows, setRows] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const suggested = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.price) || 0), 0),
    [rows],
  );

  async function load() {
    try {
      setItems(await api<Sale[]>('/v1/store-sales'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    Promise.all([
      api<Ref[]>('/v1/stores'),
      api<Ref[]>('/v1/customers'),
      api<UserRef[]>('/v1/users'),
    ])
      .then(([s, c, u]) => {
        setStores(s);
        setCustomers(c);
        setUsers(u);
      })
      .catch(() => {});
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) return toast.error('Selecione a loja.');
    setBusy(true);
    const body: CreateStoreSaleInput = {
      storeId,
      customerId: customerId || undefined,
      userId: userId || undefined,
      totalAmount: Number(total || suggested || 0),
      items: rows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity) || 1, price: Number(r.price) || 0 })),
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
    };
    try {
      await api('/v1/store-sales', { method: 'POST', body });
      toast.success('Venda registrada.');
      setCustomerId('');
      setUserId('');
      setOccurredAt('');
      setTotal('');
      setRows([]);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Vendas físicas</h1>
      <p className="text-sm text-neutral-500">Registro de vendas do balcão (performance do atendente). Não gera comissão de afiliado.</p>

      <form onSubmit={create} className="card space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[10rem]">
            <label className="label">Loja</label>
            <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
              <option value="">— selecione —</option>
              {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div className="min-w-[10rem]">
            <label className="label">Cliente (opcional)</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">—</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div className="min-w-[10rem]">
            <label className="label">Atendente (opcional)</label>
            <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">—</option>
              {users.map((u) => (<option key={u.id} value={u.id}>{u.full_name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">Data/hora</label>
            <input className="input" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Itens</label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((r) => [...r, { name: '', quantity: '1', price: '' }])}>
              + item
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input className="input flex-1" placeholder="Produto" value={r.name} onChange={(e) => setRows((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input w-20" type="number" placeholder="Qtd" value={r.quantity} onChange={(e) => setRows((a) => a.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <input className="input w-28" type="number" step="0.01" placeholder="Preço" value={r.price} onChange={(e) => setRows((a) => a.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((a) => a.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="label">Total (R$)</label>
            <input className="input w-40" type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={suggested ? String(suggested.toFixed(2)) : '0,00'} />
            {suggested > 0 && <p className="mt-1 text-xs text-neutral-400">sugerido: {brl(suggested)}</p>}
          </div>
          <button className="btn" disabled={busy || !storeId}>{busy ? 'Salvando…' : 'Registrar venda'}</button>
        </div>
      </form>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (<div key={i} className="skeleton h-14 w-full" />))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🧾</span>
          Nenhuma venda física registrada.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{brl(s.total_amount)}</p>
                <p className="text-xs text-neutral-500">
                  {dateTime(s.occurred_at)} · {s.store_name}
                  {s.customer_name ? ` · ${s.customer_name}` : ''}
                  {s.user_name ? ` · ${s.user_name}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
