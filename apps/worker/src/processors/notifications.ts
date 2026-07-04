import type { Job } from 'bullmq';
import type { NotificationJob } from '@openrate/shared';
import { withTenant } from '../lib/pg';
import { sendWhatsApp } from '../lib/evolution';
import { logger } from '../lib/logger';

// Renderização simples de mensagem por template (WhatsApp é o canal garantido
// no MVP; ver docs/01 §2.13). Templates conhecidos + fallback pelo body salvo.
function render(template: string, vars: Record<string, string | number>): string {
  switch (template) {
    case 'video_ready':
      return 'Seu vídeo está pronto para revisão no OpenRate. 🎬';
    case 'video_approved':
      return 'Boa! Seu vídeo foi aprovado e já pode ser publicado. ✅';
    case 'video_rejected':
      return `Seu vídeo foi reprovado. Motivo: ${vars.reason ?? '—'}.`;
    case 'goal_reached':
      return `Meta do dia batida! 🎯 Parabéns.`;
    case 'commission_credited':
      return `Você recebeu uma comissão de R$ ${vars.amount ?? '0,00'}. 💰`;
    case 'payout_paid':
      return `Seu pagamento de R$ ${vars.amount ?? '0,00'} foi realizado via Pix. ✅`;
    case 'image_release':
      return 'Assine o termo de cessão de imagem para começar a publicar: ' + (vars.url ?? '');
    default:
      return String(vars.body ?? 'Você tem uma notificação no OpenRate.');
  }
}

export async function processNotification(job: Job<NotificationJob>): Promise<void> {
  const { channel, template, to, vars, notificationId } = job.data;

  if (channel !== 'whatsapp') {
    logger.info({ channel, template }, 'canal não-whatsapp: registrando como enviado (in-app)');
    await markSent(job.data, notificationId, true, null);
    return;
  }

  const text = render(template, vars);
  try {
    await sendWhatsApp(to, text);
    await markSent(job.data, notificationId, true, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSent(job.data, notificationId, false, msg);
    throw err; // deixa o BullMQ aplicar retry/backoff
  }
}

async function markSent(
  tenant: NotificationJob,
  id: string,
  ok: boolean,
  error: string | null,
): Promise<void> {
  await withTenant(tenant, (client) =>
    client.query(
      `UPDATE openrate.notifications
          SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END, error = $3
        WHERE id = $1`,
      [id, ok ? 'sent' : 'failed', error],
    ),
  );
}
