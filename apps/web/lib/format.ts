// Formatação consistente (pt-BR) — evita "R$ 12.5" e datas cruas espalhadas.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const DATETIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function brl(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return BRL.format(Number.isFinite(n) ? n : 0);
}

export function date(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATE.format(d);
}

export function dateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATETIME.format(d);
}

// Tempo relativo curto (pt-BR): "agora", "5 min", "3 h", "2 d". Cai para a data
// absoluta acima de ~7 dias. Usado na central de notificações.
export function timeAgo(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'agora';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d`;
  return DATE.format(d);
}
