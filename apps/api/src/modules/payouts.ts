import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Module,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { payPayoutSchema, type PayPayoutInput, type TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { S3Service } from '../common/s3';
import { env } from '../common/env';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { QueuesService } from '../queues.service';
import { simplePdf, type PdfLine } from '../common/pdf';
import { toCsv } from '../common/csv';

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function fmtBrl(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Recibo em PDF (texto puro, fonte base-14). Comprovante do repasse Pix.
function buildReceiptPdf(p: Record<string, unknown>): Buffer {
  const org = (p.trade_name as string) || (p.org_name as string) || 'OpenRate';
  const lines: PdfLine[] = [
    { text: 'Recibo de Pagamento', y: 70, size: 20, bold: true },
    { text: org, y: 96, size: 12 },
    { text: 'Beneficiário', y: 150, bold: true },
    { text: `${p.full_name ?? '—'}  (${p.email ?? '—'})`, y: 168 },
    { text: 'Período de apuração', y: 200, bold: true },
    { text: `${fmtDate(p.period_start)} a ${fmtDate(p.period_end)}`, y: 218 },
    { text: 'Chave Pix', y: 250, bold: true },
    { text: `${p.pix_key ?? '—'}  (${p.pix_key_type ?? '—'})`, y: 268 },
    { text: 'Pago em', y: 300, bold: true },
    { text: fmtDate(p.paid_at), y: 318 },
    { text: `Valor: ${fmtBrl(p.total_amount)}`, y: 366, size: 16, bold: true },
    { text: `Recibo nº ${p.id}`, y: 410, size: 9 },
    { text: 'Documento gerado eletronicamente pela plataforma OpenRate.', y: 800, size: 8 },
  ];
  return simplePdf(lines);
}

@Controller('payouts')
class PayoutsController {
  constructor(
    private readonly pg: PgService,
    private readonly s3: S3Service,
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

  // Export CSV do fechamento (para contabilidade). Sem :id → não colide com
  // as rotas de aprovação/pagamento (essas são POST) nem com :id/receipt.
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payouts.csv"')
  exportCsv(@CurrentTenant() t: TenantContext): Promise<string> {
    return this.pg.withTenant(t, async (c) => {
      const r = await c.query(
        `SELECT p.id, u.full_name, u.email, p.period_start, p.period_end,
                p.total_amount, p.status, p.pix_key, p.pix_key_type, p.paid_at
           FROM openrate.payouts p
           JOIN openrate.users u ON u.id = p.user_id
          ORDER BY p.created_at DESC LIMIT 5000`,
      );
      return toCsv(
        ['id', 'atendente', 'email', 'inicio', 'fim', 'valor', 'status', 'pix', 'pix_tipo', 'pago_em'],
        r.rows.map((x) => [
          x.id, x.full_name, x.email, x.period_start, x.period_end,
          x.total_amount, x.status, x.pix_key, x.pix_key_type, x.paid_at,
        ]),
      );
    });
  }

  // Pagamento automático via Asaas (fase Escala). Enquanto a integração não está
  // habilitada, responde 501 e o gestor usa o "Registrar pagamento" manual.
  @Post(':id/pay-pix')
  @Roles('manager')
  async payPix(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
  ): Promise<{ payoutId: string; status: string }> {
    if (!env.integrations.asaas) {
      throw new NotImplementedException(
        'Pagamento automático via Asaas não habilitado (fase Escala). Use "Registrar pagamento".',
      );
    }
    if (!t.orgId) throw new BadRequestException('org ausente');
    const status = await this.pg.withTenant(t, async (c) => {
      const r = await c.query<{ status: string }>(
        `UPDATE openrate.payouts SET status = 'processing'
           WHERE id = $1 AND status = 'approved' RETURNING status`,
        [id],
      );
      if ((r.rowCount ?? 0) === 0) throw new BadRequestException('payout precisa estar aprovado');
      return r.rows[0].status;
    });
    // SEM retry automático (financeiro): o worker processa e o webhook do Asaas
    // conclui para 'paid'/'failed'. Reprocesso manual via Bull Board.
    await this.queues.enqueuePayoutPix({ orgId: t.orgId, correlationId: t.correlationId, payoutId: id });
    return { payoutId: id, status };
  }

  // Recibo em PDF do repasse já pago. Gera sob demanda e cacheia em receipt_key.
  @Get(':id/receipt')
  @Roles('manager')
  async receipt(@CurrentTenant() t: TenantContext, @Param('id') id: string): Promise<{ url: string }> {
    const p = await this.pg.withTenant(t, async (c) => {
      const r = await c.query(
        `SELECT p.*, u.full_name, u.email, o.name AS org_name, o.trade_name
           FROM openrate.payouts p
           JOIN openrate.users u ON u.id = p.user_id
           JOIN openrate.organizations o ON o.id = p.organization_id
          WHERE p.id = $1`,
        [id],
      );
      if ((r.rowCount ?? 0) === 0) throw new NotFoundException('payout não encontrado');
      return r.rows[0] as Record<string, unknown>;
    });
    if (p.status !== 'paid') throw new BadRequestException('recibo disponível somente após o pagamento');

    let key = (p.receipt_key as string | null) ?? null;
    if (!key) {
      key = `receipts/${p.organization_id}/${id}.pdf`;
      await this.s3.putObject(key, buildReceiptPdf(p), 'application/pdf');
      await this.pg.withTenant(t, (c) =>
        c.query('UPDATE openrate.payouts SET receipt_key = $2 WHERE id = $1', [id, key]),
      );
    }
    const url = await this.s3.presignGet(key, 900, `recibo-${id}.pdf`);
    return { url };
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
