'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import type { Address, CreateStoreInput } from '@openrate/shared';

interface Store {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: Address | null;
  active: boolean;
}

const EMPTY = {
  name: '',
  document: '',
  phone: '',
  whatsapp: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

export default function StoresPage() {
  const toast = useToast();
  const [items, setItems] = useState<Store[] | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function load() {
    try {
      setItems(await api<Store[]>('/v1/stores'));
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
    const address: Address = {
      cep: f.cep || undefined,
      street: f.street || undefined,
      number: f.number || undefined,
      complement: f.complement || undefined,
      district: f.district || undefined,
      city: f.city || undefined,
      state: f.state ? f.state.toUpperCase() : undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);
    const body: CreateStoreInput = {
      name: f.name,
      document: f.document || undefined,
      phone: f.phone || undefined,
      whatsapp: f.whatsapp || undefined,
      address: hasAddress ? address : undefined,
    };
    try {
      await api('/v1/stores', { method: 'POST', body });
      toast.success('Loja criada.');
      setF({ ...EMPTY });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1>Lojas</h1>

      <form onSubmit={create} className="card space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[14rem]">
            <label className="label">Nome da loja</label>
            <input className="input" value={f.name} onChange={set('name')} required />
          </div>
          <div className="min-w-[10rem]">
            <label className="label">CNPJ</label>
            <input className="input" value={f.document} onChange={set('document')} placeholder="00.000.000/0000-00" />
          </div>
          <div className="min-w-[9rem]">
            <label className="label">Telefone</label>
            <input className="input" value={f.phone} onChange={set('phone')} placeholder="(00) 0000-0000" />
          </div>
          <div className="min-w-[9rem]">
            <label className="label">WhatsApp</label>
            <input className="input" value={f.whatsapp} onChange={set('whatsapp')} placeholder="(00) 00000-0000" />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="w-28">
            <label className="label">CEP</label>
            <input className="input" value={f.cep} onChange={set('cep')} placeholder="00000-000" />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="label">Rua</label>
            <input className="input" value={f.street} onChange={set('street')} />
          </div>
          <div className="w-24">
            <label className="label">Número</label>
            <input className="input" value={f.number} onChange={set('number')} />
          </div>
          <div className="min-w-[8rem]">
            <label className="label">Complemento</label>
            <input className="input" value={f.complement} onChange={set('complement')} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[10rem]">
            <label className="label">Bairro</label>
            <input className="input" value={f.district} onChange={set('district')} />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="label">Cidade</label>
            <input className="input" value={f.city} onChange={set('city')} />
          </div>
          <div className="w-20">
            <label className="label">UF</label>
            <input className="input" value={f.state} onChange={set('state')} maxLength={2} placeholder="SP" />
          </div>
          <button className="btn" disabled={busy || !f.name}>
            {busy ? 'Salvando…' : 'Criar loja'}
          </button>
        </div>
      </form>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🏬</span>
          Nenhuma loja ainda. Cadastre a primeira acima.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-neutral-500">
                  {[s.address?.city, s.address?.state].filter(Boolean).join(' / ') || '—'}
                  {s.phone ? ` · ${s.phone}` : ''}
                </p>
              </div>
              <span className={`badge ${s.active ? 'badge-green' : 'badge-neutral'}`}>
                {s.active ? 'Ativa' : 'Inativa'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
