'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useToast } from '../../../components/toast';
import { Modal } from '../../../components/modal';
import { USER_ROLES, roleAtLeast, PIX_KEY_TYPES, type UserRole, type PixKeyType } from '@openrate/shared';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  active: boolean;
  stores: string[];
  image_release_status?: string;
}
interface Store {
  id: string;
  name: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super admin',
  owner: 'Dono',
  manager: 'Gerente',
  attendant: 'Atendente',
};

export default function UsersPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [busy, setBusy] = useState(false);
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null);

  // form de convite
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('attendant');
  const [phone, setPhone] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>('cpf');

  const myRole = me?.role ?? 'attendant';
  const invitableRoles = USER_ROLES.filter((r) => r !== 'super_admin' && roleAtLeast(myRole, r));

  async function load() {
    try {
      const [u, s] = await Promise.all([api<User[]>('/v1/users'), api<Store[]>('/v1/stores')]);
      setUsers(u);
      setStores(s);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setUsers([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function toggleStore(id: string) {
    setStoreIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ email: string; tempPassword: string }>('/v1/users/invite', {
        method: 'POST',
        body: {
          email,
          fullName,
          role,
          phone: phone || undefined,
          storeIds: storeIds.length ? storeIds : undefined,
          defaultStoreId: storeIds[0] ?? undefined,
          pixKey: pixKey || undefined,
          pixKeyType: pixKey ? pixKeyType : undefined,
        },
      });
      setTempPw({ email: res.email, password: res.tempPassword });
      toast.success(phone ? 'Convite criado e enviado por WhatsApp.' : 'Convite criado.');
      setEmail('');
      setFullName('');
      setPhone('');
      setStoreIds([]);
      setPixKey('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/v1/users/${id}`, { method: 'PATCH', body });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function resetPw(u: User) {
    try {
      const res = await api<{ tempPassword: string }>(`/v1/users/${u.id}/reset-password`, { method: 'POST' });
      setTempPw({ email: u.email, password: res.tempPassword });
      toast.success('Senha redefinida.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success('Copiado.');
    } catch {
      toast.info(text);
    }
  }

  const canManage = (u: User) => u.role !== 'super_admin' && roleAtLeast(myRole, u.role) && u.id !== me?.user.id;

  return (
    <div className="space-y-4">
      <h1>Usuários</h1>

      <form onSubmit={invite} className="card space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label className="label">Nome</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="label">E-mail</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="min-w-[9rem]">
            <label className="label">Papel</label>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {invitableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem]">
            <label className="label">Telefone (WhatsApp)</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
        </div>

        {stores.length > 0 && (
          <div>
            <label className="label">Lojas vinculadas (a 1ª marcada é a principal)</label>
            <div className="flex flex-wrap gap-2">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2 py-1 text-sm">
                  <input type="checkbox" checked={storeIds.includes(s.id)} onChange={() => toggleStore(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[10rem]">
            <label className="label">Chave Pix (opcional)</label>
            <input className="input" value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
          </div>
          <div className="min-w-[8rem]">
            <label className="label">Tipo</label>
            <select className="select" value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value as PixKeyType)}>
              {PIX_KEY_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p === 'evp' ? 'aleatória' : p}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" disabled={busy || !email || !fullName}>
            {busy ? 'Convidando…' : 'Convidar usuário'}
          </button>
        </div>
      </form>

      {users === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="empty">
          <span className="text-2xl">👥</span>
          Nenhum usuário ainda. Convide o primeiro acima.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Papel</th>
                <th>Lojas</th>
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">{u.full_name}</div>
                    <div className="text-xs text-neutral-500">{u.email}</div>
                  </td>
                  <td>
                    {canManage(u) ? (
                      <select
                        className="select w-auto py-1 text-xs"
                        value={u.role}
                        onChange={(e) => patch(u.id, { role: e.target.value })}
                      >
                        {invitableRoles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="badge badge-neutral">{ROLE_LABELS[u.role]}</span>
                    )}
                  </td>
                  <td className="text-xs text-neutral-500">{u.stores.length ? u.stores.join(', ') : '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className={`badge ${u.active ? 'badge-green' : 'badge-neutral'}`}>
                        {u.active ? 'Ativo' : 'Inativo'}
                      </span>
                      {u.role === 'attendant' && (
                        <span
                          className={
                            'badge ' +
                            (u.image_release_status === 'signed'
                              ? 'badge-green'
                              : u.image_release_status === 'revoked'
                                ? 'badge-red'
                                : 'badge-amber')
                          }
                          title="Cessão de direito de imagem"
                        >
                          {u.image_release_status === 'signed'
                            ? 'Cessão ✓'
                            : u.image_release_status === 'revoked'
                              ? 'Cessão revogada'
                              : 'Cessão pendente'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    {canManage(u) ? (
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost btn-sm" onClick={() => patch(u.id, { active: !u.active })}>
                          {u.active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button className="btn-ghost btn-sm" onClick={() => resetPw(u)}>
                          Resetar senha
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={tempPw !== null}
        onClose={() => setTempPw(null)}
        title="Senha temporária"
        footer={<button className="btn" onClick={() => setTempPw(null)}>Fechar</button>}
      >
        <p className="text-sm text-neutral-600">
          Repasse esta senha para <b>{tempPw?.email}</b>. Ela será trocada no primeiro acesso.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-neutral-100 px-3 py-2 font-mono text-sm">{tempPw?.password}</code>
          <button className="btn-ghost btn-sm" onClick={() => tempPw && copy(tempPw.password)}>Copiar</button>
        </div>
      </Modal>
    </div>
  );
}
