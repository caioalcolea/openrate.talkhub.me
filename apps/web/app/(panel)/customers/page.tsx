'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import type { Address, CreateCustomerInput } from '@openrate/shared';

interface Customer {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  origin: string | null;
  tags: string[];
  lgpd_consent: boolean;
}
interface Ref {
  id: string;
  name: string;
}

const ORIGINS = ['loja_fisica', 'video_tiktok', 'instagram', 'indicacao', 'outro'] as const;
const ORIGIN_LABELS: Record<string, string> = {
  loja_fisica: 'Loja física',
  video_tiktok: 'Vídeo TikTok',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
};

const EMPTY = {
  name: '', document: '', email: '', phone: '', whatsapp: '', birthdate: '', gender: '',
  origin: '', storeId: '', tags: '', notes: '', lgpdConsent: false,
  cep: '', street: '', number: '', complement: '', district: '', city: '', state: '',
};

export default function CustomersPage() {
  const toast = useToast();
  const [items, setItems] = useState<Customer[] | null>(null);
  const [stores, setStores] = useState<Ref[]>([]);
  const [q, setQ] = useState('');
  const [f, setF] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function load() {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      setItems(await api<Customer[]>(`/v1/customers${params.toString() ? `?${params}` : ''}`));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }
  useEffect(() => {
    api<Ref[]>('/v1/stores').then(setStores).catch(() => setStores([]));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const address: Address = {
      cep: f.cep || undefined, street: f.street || undefined, number: f.number || undefined,
      complement: f.complement || undefined, district: f.district || undefined,
      city: f.city || undefined, state: f.state ? f.state.toUpperCase() : undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);
    const tags = f.tags.split(',').map((s) => s.trim()).filter(Boolean);
    const body: CreateCustomerInput = {
      name: f.name,
      document: f.document || undefined,
      email: f.email || undefined,
      phone: f.phone || undefined,
      whatsapp: f.whatsapp || undefined,
      birthdate: f.birthdate || undefined,
      gender: f.gender || undefined,
      origin: f.origin || undefined,
      storeId: f.storeId || undefined,
      tags: tags.length ? tags : undefined,
      notes: f.notes || undefined,
      lgpdConsent: f.lgpdConsent,
      address: hasAddress ? address : undefined,
    };
    try {
      await api('/v1/customers', { method: 'POST', body });
      toast.success('Cliente cadastrado.');
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
      <h1>Clientes</h1>

      <form onSubmit={create} className="card space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[12rem]"><label className="label">Nome</label><input className="input" value={f.name} onChange={set('name')} required /></div>
          <div className="min-w-[10rem]"><label className="label">CPF/CNPJ</label><input className="input" value={f.document} onChange={set('document')} /></div>
          <div className="min-w-[10rem]"><label className="label">E-mail</label><input className="input" type="email" value={f.email} onChange={set('email')} /></div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[9rem]"><label className="label">Telefone</label><input className="input" value={f.phone} onChange={set('phone')} /></div>
          <div className="min-w-[9rem]"><label className="label">WhatsApp</label><input className="input" value={f.whatsapp} onChange={set('whatsapp')} /></div>
          <div><label className="label">Nascimento</label><input className="input w-40" type="date" value={f.birthdate} onChange={set('birthdate')} /></div>
          <div className="min-w-[8rem]">
            <label className="label">Gênero</label>
            <select className="select" value={f.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[9rem]">
            <label className="label">Origem</label>
            <select className="select" value={f.origin} onChange={set('origin')}>
              <option value="">—</option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem]">
            <label className="label">Loja</label>
            <select className="select" value={f.storeId} onChange={set('storeId')}>
              <option value="">— rede —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[10rem]"><label className="label">Tags (vírgula)</label><input className="input" value={f.tags} onChange={set('tags')} /></div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-28"><label className="label">CEP</label><input className="input" value={f.cep} onChange={set('cep')} /></div>
          <div className="flex-1 min-w-[10rem]"><label className="label">Rua</label><input className="input" value={f.street} onChange={set('street')} /></div>
          <div className="w-20"><label className="label">Nº</label><input className="input" value={f.number} onChange={set('number')} /></div>
          <div className="min-w-[8rem]"><label className="label">Bairro</label><input className="input" value={f.district} onChange={set('district')} /></div>
          <div className="min-w-[8rem]"><label className="label">Cidade</label><input className="input" value={f.city} onChange={set('city')} /></div>
          <div className="w-16"><label className="label">UF</label><input className="input" value={f.state} onChange={set('state')} maxLength={2} /></div>
        </div>
        <div><label className="label">Observações</label><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.lgpdConsent} onChange={(e) => setF((s) => ({ ...s, lgpdConsent: e.target.checked }))} />
            Consentimento LGPD (marketing)
          </label>
          <button className="btn" disabled={busy || !f.name}>{busy ? 'Salvando…' : 'Cadastrar cliente'}</button>
        </div>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, documento ou e-mail (Enter)" />
        <button className="btn-ghost">Buscar</button>
      </form>

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">🧑‍🤝‍🧑</span>
          Nenhum cliente. Cadastre o primeiro acima.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-neutral-500">
                  {[c.document, c.phone || c.whatsapp, c.email].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {c.origin && <span className="badge badge-neutral">{ORIGIN_LABELS[c.origin] ?? c.origin}</span>}
                {c.lgpd_consent && <span className="badge badge-green">LGPD ✓</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
