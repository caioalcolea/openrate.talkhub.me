'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Step {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
  cta: string;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// Checklist "primeiros passos": detecta o estado real via endpoints existentes e
// leva o usuário às telas de cadastro. Fecha o onboarding 100% pela UI.
export function OnboardingChecklist({ showWhenComplete = false }: { showWhenComplete?: boolean }) {
  const { me } = useAuth();
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const hasOrg = !!me.org;
      // Sem org (super_admin ainda não entrou): só o passo 1 é acionável.
      const [stores, users, products] = hasOrg
        ? await Promise.all([
            safe(api<{ id: string }[]>('/v1/stores'), []),
            safe(api<{ role: string }[]>('/v1/users'), []),
            safe(api<{ id: string }[]>('/v1/products'), []),
          ])
        : [[], [], []];
      const firstProduct = products[0]?.id;
      const ideas = firstProduct ? await safe(api<unknown[]>(`/v1/products/${firstProduct}/ideas`), []) : [];

      setSteps([
        {
          key: 'org',
          label: 'Entrar em uma organização',
          hint: 'Crie ou entre em uma organização (rede de lojas).',
          done: hasOrg,
          href: '/orgs',
          cta: 'Organizações',
        },
        {
          key: 'store',
          label: 'Cadastrar uma loja',
          hint: 'Adicione ao menos uma loja da rede.',
          done: stores.length > 0,
          href: '/stores',
          cta: 'Lojas',
        },
        {
          key: 'attendant',
          label: 'Convidar um atendente',
          hint: 'Convide quem vai gravar os vídeos.',
          done: users.some((u) => u.role === 'attendant'),
          href: '/users',
          cta: 'Usuários',
        },
        {
          key: 'product',
          label: 'Cadastrar um produto',
          hint: 'Cadastre o primeiro produto para gerar ideias.',
          done: products.length > 0,
          href: '/products/new',
          cta: 'Novo produto',
        },
        {
          key: 'ideas',
          label: 'Gerar ideias de vídeo',
          hint: 'Use a IA para criar roteiros do produto.',
          done: ideas.length > 0,
          href: firstProduct ? `/products/${firstProduct}/ideas` : '/products',
          cta: 'Gerar ideias',
        },
      ]);
    })();
  }, [me]);

  if (!steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const complete = doneCount === steps.length;
  if (complete && !showWhenComplete) return null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Primeiros passos</h2>
          <p className="text-sm text-neutral-500">{doneCount}/{steps.length} concluídos</p>
        </div>
        {complete && <span className="badge badge-green">Tudo pronto 🎉</span>}
      </div>
      <div className="h-2 w-full rounded bg-neutral-200">
        <div className="h-2 rounded bg-brand transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          // O primeiro passo pendente é o "ativo"; os seguintes ficam apenas visíveis.
          const firstPending = steps.findIndex((x) => !x.done);
          const active = i === firstPending;
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className={
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ' +
                  (s.done ? 'bg-green-100 text-green-700' : active ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-500')
                }
              >
                {s.done ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={'text-sm font-medium ' + (s.done ? 'text-neutral-400 line-through' : '')}>{s.label}</p>
                {!s.done && <p className="text-xs text-neutral-500">{s.hint}</p>}
              </div>
              {!s.done && (
                <Link href={s.href} className="btn-ghost btn-sm shrink-0">
                  {s.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
