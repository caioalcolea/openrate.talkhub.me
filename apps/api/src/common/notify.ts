import type { TenantContext } from '@openrate/shared';
import { PgService } from './pg.service';
import { QueuesService } from '../queues.service';

// Grava uma notificação (visível in-app em /v1/notifications) e enfileira o envio
// por WhatsApp quando o usuário tem telefone. Best-effort: nunca derruba a ação
// principal (que já foi commitada). Reaproveitado por vídeos/vendas/etc.
export async function notifyUser(
  pg: PgService,
  queues: QueuesService,
  t: TenantContext,
  o: { userId: string; template: string; body: string; vars?: Record<string, string> },
): Promise<void> {
  if (!t.orgId) return;
  try {
    const { phone, notifId } = await pg.withTenant(t, async (c) => {
      const u = await c.query<{ phone: string | null }>('SELECT phone FROM openrate.users WHERE id = $1', [o.userId]);
      const n = await c.query<{ id: string }>(
        `INSERT INTO openrate.notifications (organization_id, user_id, channel, template, body, status, payload)
         VALUES ($1,$2,'whatsapp',$3,$4,'pending',$5) RETURNING id`,
        [t.orgId, o.userId, o.template, o.body, JSON.stringify(o.vars ?? {})],
      );
      return { phone: u.rows[0]?.phone ?? null, notifId: n.rows[0].id };
    });
    if (phone) {
      await queues.enqueueNotification({
        orgId: t.orgId,
        userId: o.userId,
        correlationId: t.correlationId,
        notificationId: notifId,
        channel: 'whatsapp',
        template: o.template,
        to: phone,
        vars: o.vars ?? {},
      });
    }
  } catch {
    // best-effort: a notificação fica pendente/não enfileirada, sem afetar a operação.
  }
}
