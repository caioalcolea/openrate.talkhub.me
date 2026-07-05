'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ORG_PLANS, ORG_STATUSES, type OrgPlan, type OrgStatus } from '@openrate/shared';

interface Org {
  id: string;
  name: string;
  trade_name: string | null;
  slug: string;
  document: string | null;
  plan: OrgPlan;
  status: OrgStatus;
  active: boolean;
}

const PLAN_LABELS: Record<OrgPlan, string> = { free: 'Free', pro: 'Pro', rede: 'Rede' };
const STATUS_LABELS: Record<OrgStatus, string> = {
  active: 'Ativa',
  suspended: 'Suspensa',
  churned: 'Cancelada',
};
const STATUS_CLS: Record<OrgStatus, string> = {
  active: 'badge-green',
  suspended: 'badge-amber',
  churned: 'badge-red',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function OrgsPage() {
  const { me, switchOrg } = useAuth();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState<OrgPlan>('free');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);

  async function load() {
    try {
      setOrgs(await api<Org[]>('/v1/orgs'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setOrgs([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/v1/orgs', {
        method: 'POST',
        body: { name, slug: slug || slugify(name), tradeName: tradeName || undefined, plan },
      });
      setName('');
      setTradeName('');
      setSlug('');
      setPlan('free');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: OrgStatus) {
    setError('');
    try {
      await api(`/v1/orgs/${id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function enter(id: string) {
    setEntering(id);
    setError('');
    try {
      await switchOrg(id);
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setEntering(null);
    }
  }

  const currentOrgId = me?.org?.id ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Organizações</h1>
        <p className="text-sm text-neutral-500">
          Crie uma organização (rede de lojas) e <strong>entre</strong> nela para operar —
          criar lojas, produtos, metas e convidar usuários.
        </p>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <form onSubmit={create} className="card flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex-1 min-w-[12rem]">
          <label className="label">Nome da organização</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Rede Talkhub" required />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label className="label">Nome fantasia (opcional)</label>
          <input className="input" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[8rem]">
          <label className="label">Slug (opcional)</label>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={name ? slugify(name) : 'rede-talkhub'} />
        </div>
        <div>
          <label className="label">Plano</label>
          <select className="select" value={plan} onChange={(e) => setPlan(e.target.value as OrgPlan)}>
            {ORG_PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" disabled={busy || !name}>
          {busy ? 'Criando…' : 'Criar organização'}
        </button>
      </form>

      {orgs === null ? (
        <div className="text-sm text-neutral-500">Carregando…</div>
      ) : orgs.length === 0 ? (
        <div className="empty">Nenhuma organização ainda. Crie a primeira acima.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Plano</th>
                <th>Status</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-neutral-500">{o.trade_name ?? o.slug}</div>
                  </td>
                  <td>
                    <span className="badge badge-blue">{PLAN_LABELS[o.plan]}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${STATUS_CLS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                      <select
                        className="select w-auto py-1 text-xs"
                        value={o.status}
                        onChange={(e) => changeStatus(o.id, e.target.value as OrgStatus)}
                        aria-label="Alterar status"
                      >
                        {ORG_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="text-right">
                    {o.id === currentOrgId ? (
                      <span className="badge badge-green">você está aqui</span>
                    ) : (
                      <button className="btn btn-sm" onClick={() => enter(o.id)} disabled={entering === o.id}>
                        {entering === o.id ? 'Entrando…' : 'Entrar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
