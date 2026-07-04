'use client';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import type { UpdatePixInput } from '@openrate/shared';

const TYPES: { value: UpdatePixInput['pixKeyType']; label: string }[] = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'evp', label: 'Aleatória (EVP)' },
];

export default function PixPage() {
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<UpdatePixInput['pixKeyType']>('cpf');
  const [cpf, setCpf] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body: UpdatePixInput = { pixKey, pixKeyType, cpf: cpf || undefined };
    await api('/v1/me/pix', { method: 'PATCH', body });
    setMsg('Chave Pix salva. É para ela que suas comissões serão pagas.');
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Minha chave Pix</h1>
      <p className="text-sm text-neutral-500">Cadastre a chave que receberá suas comissões.</p>
      <form onSubmit={save} className="card flex flex-col gap-3">
        <select className="input" value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value as UpdatePixInput['pixKeyType'])}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input className="input" placeholder="Chave Pix" value={pixKey} onChange={(e) => setPixKey(e.target.value)} required />
        <input className="input" placeholder="CPF (para validação do recebedor)" value={cpf} onChange={(e) => setCpf(e.target.value)} />
        <button className="btn" type="submit">Salvar</button>
      </form>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </div>
  );
}
