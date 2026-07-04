'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

interface Org {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  active: boolean;
}

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
  const [slug, setSlug] = useState('');
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
      await api('/v1/orgs', { method: 'POST', body: { name, slug: slug || slugify(name) } });
      setName('');
      setSlug('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
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

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={create} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Nome da organização</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Rede Talkhub"
            required
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Slug (opcional)</label>
          <input
            className="input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={name ? slugify(name) : 'rede-talkhub'}
          />
        </div>
        <button className="btn" disabled={busy || !name}>
          {busy ? 'Criando…' : 'Criar organização'}
        </button>
      </form>

      {orgs === null ? (
        <div className="text-sm text-neutral-500">Carregando…</div>
      ) : orgs.length === 0 ? (
        <div className="card text-center text-sm text-neutral-500">
          Nenhuma organização ainda. Crie a primeira acima.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{o.name}</td>
                  <td className="px-4 py-2 text-neutral-500">{o.slug}</td>
                  <td className="px-4 py-2">
                    {o.id === currentOrgId ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        você está aqui
                      </span>
                    ) : o.active ? (
                      <span className="text-neutral-500">ativa</span>
                    ) : (
                      <span className="text-neutral-400">inativa</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="btn"
                      onClick={() => enter(o.id)}
                      disabled={entering === o.id || o.id === currentOrgId}
                    >
                      {entering === o.id ? 'Entrando…' : o.id === currentOrgId ? 'Atual' : 'Entrar'}
                    </button>
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
