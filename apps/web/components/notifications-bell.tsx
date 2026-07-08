'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

interface Notification {
  id: string;
  channel: string;
  template: string;
  title: string | null;
  body: string | null;
  status: string;
  read_at: string | null;
  created_at: string;
}

// Rótulo + ícone por template (fallback razoável para templates futuros).
const TEMPLATES: Record<string, { label: string; icon: string }> = {
  video_approved: { label: 'Vídeo aprovado', icon: '✅' },
  video_rejected: { label: 'Vídeo reprovado', icon: '⚠️' },
  goal_reached: { label: 'Meta batida', icon: '🎯' },
  commission_credited: { label: 'Comissão creditada', icon: '💰' },
  user_invited: { label: 'Convite enviado', icon: '✉️' },
  password_reset: { label: 'Senha redefinida', icon: '🔑' },
};

function labelFor(template: string): { label: string; icon: string } {
  return TEMPLATES[template] ?? { label: template.replace(/_/g, ' '), icon: '🔔' };
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// Sino de notificações com contador de não-lidas e dropdown. Marca uma como lida
// ao clicar e oferece "marcar todas como lidas". Faz polling leve a cada 60s.
export function NotificationsBell({ align = 'left' }: { align?: 'left' | 'right' }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setItems(await safe(api<Notification[]>('/v1/notifications'), []));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unread = items.filter((n) => n.status !== 'read').length;

  async function markOne(n: Notification) {
    if (n.status === 'read') return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, status: 'read' } : x)));
    await safe(api(`/v1/notifications/${n.id}/read`, { method: 'POST' }), undefined);
  }

  async function markAll() {
    setItems((prev) => prev.map((x) => ({ ...x, status: 'read' })));
    await safe(api('/v1/notifications/read-all', { method: 'POST' }), undefined);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Notificações"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={
            'absolute z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg ' +
            (align === 'right' ? 'right-0' : 'left-0')
          }
        >
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
            <span className="text-sm font-semibold">Notificações</span>
            {unread > 0 && (
              <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={markAll}>
                marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">Nenhuma notificação.</p>
            ) : (
              items.map((n) => {
                const meta = labelFor(n.template);
                const isUnread = n.status !== 'read';
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void markOne(n)}
                    className={
                      'flex w-full gap-3 border-b border-neutral-50 px-4 py-3 text-left last:border-0 hover:bg-neutral-50 ' +
                      (isUnread ? 'bg-brand/5' : '')
                    }
                  >
                    <span className="mt-0.5 text-base leading-none">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-neutral-800">{n.title ?? meta.label}</span>
                        <span className="shrink-0 text-[11px] text-neutral-400">{timeAgo(n.created_at)}</span>
                      </div>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{n.body}</p>}
                    </div>
                    {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
