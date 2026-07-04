import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { payPayoutSchema, type PayPayoutInput, type TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { QueuesService } from '../queues.service';

@Controller('payouts')
class PayoutsController {
  constructor(
    private readonly pg: PgService,
    private readonly queues: QueuesService,
  ) {}

  @Get()
  list(@CurrentTenant() t: TenantContext, @Query('status') status?: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, user_id, period_start, period_end, total_amount, status,
                  pix_key, pix_key_type, approved_at, paid_at
             FROM openrate.payouts
            WHERE ($1::text IS NULL OR status = $1::openrate.payout_status)
            ORDER BY created_at DESC LIMIT 500`,
          [status ?? null],
        )
        .then((r) => r.rows),
    );
  }

  // Aprovação do fechamento pelo owner: pending_approval → approved.
  @Post(':id/approve')
  @Roles('owner')
  approve(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, async (c) => {
      const r = await c.query(
        `UPDATE openrate.payouts
            SET status = 'approved', approved_by = $2, approved_at = now()
          WHERE id = $1 AND status = 'pending_approval'
          RETURNING id, status`,
        [id, t.userId],
      );
      if ((r.rowCount ?? 0) === 0) throw new NotFoundException('payout não está em pending_approval');
      return r.rows[0];
    });
  }

  // Registro do pagamento manual (Pix feito fora, registrado dentro): approved →
  // paid; marca os lançamentos como pagos e notifica o atendente.
  @Post(':id/pay')
  @Roles('owner')
  async pay(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payPayoutSchema)) dto: PayPayoutInput,
  ) {
    const result = await this.pg.withTenant(t, async (c) => {
      const p = await c.query(
        `UPDATE openrate.payouts SET status = 'paid', paid_at = now()
          WHERE id = $1 AND status = 'approved'
          RETURNING id, user_id, total_amount`,
        [id],
      );
      if ((p.rowCount ?? 0) === 0) throw new NotFoundException('payout não está aprovado');
      const payout = p.rows[0];

      await c.query(
        `UPDATE openrate.commission_entries SET status = 'paid' WHERE payout_id = $1 AND reversal_of IS NULL`,
        [id],
      );

      const notif = await c.query(
        `INSERT INTO openrate.notifications (organization_id, user_id, channel, template, body, status, payload)
         VALUES ($1,$2,'whatsapp','payout_paid',$3,'pending',$4) RETURNING id`,
        [
          t.orgId,
          payout.user_id,
          `Seu pagamento de R$ ${payout.total_amount} foi realizado via Pix.`,
          JSON.stringify({ payoutId: id, proof: dto.proof ?? null }),
        ],
      );

      const u = await c.query('SELECT phone FROM openrate.users WHERE id = $1', [payout.user_id]);
      return {
        payout,
        notificationId: notif.rows[0].id,
        phone: u.rows[0]?.phone ?? null,
      };
    });

    // Best-effort: o pagamento JÁ foi commitado. Se o enfileiramento falhar
    // (ex.: Redis fora), a notificação fica 'pending' e não derruba o payout.
    if (result.phone && t.orgId) {
      try {
        await this.queues.enqueueNotification({
          orgId: t.orgId,
          userId: result.payout.user_id,
          correlationId: t.correlationId,
          notificationId: result.notificationId,
          channel: 'whatsapp',
          template: 'payout_paid',
          to: result.phone,
          vars: { amount: String(result.payout.total_amount) },
        });
      } catch {
        // notificação será reprocessada; pagamento permanece pago.
      }
    }
    return { id, status: 'paid' };
  }
}

@Module({ controllers: [PayoutsController] })
export class PayoutsModule {}
