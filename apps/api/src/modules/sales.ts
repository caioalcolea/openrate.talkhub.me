import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  affiliateSaleRowSchema,
  type AffiliateSaleRow,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { Roles } from '../auth/roles.decorator';
import { notifyUser } from '../common/notify';
import { QueuesService } from '../queues.service';
import { ingestConfirmedSale, reverseSale, type AffiliateLinkRef } from '../common/commission-ingest';

type CreatorCredit = { userId: string; amount: number };

interface RowResult {
  line: number;
  externalId?: string;
  status: 'imported' | 'duplicated' | 'no_rule' | 'error';
  message?: string;
}

// Resolve o link de afiliado (e a categoria do produto) para dar contexto ao motor.
async function resolveLink(
  c: PoolClient,
  shortCode: string,
): Promise<{ link: AffiliateLinkRef; categoryId: string | null } | null> {
  const r = await c.query(
    `SELECT l.id, l.user_id, l.store_id, l.product_id, p.category_id
       FROM openrate.affiliate_links l
       LEFT JOIN openrate.products p ON p.id = l.product_id
      WHERE l.short_code = $1`,
    [shortCode],
  );
  if ((r.rowCount ?? 0) === 0) return null;
  const row = r.rows[0];
  return {
    link: { id: row.id, userId: row.user_id, storeId: row.store_id, productId: row.product_id },
    categoryId: row.category_id,
  };
}

async function ingestRow(
  c: PoolClient,
  orgId: string,
  row: AffiliateSaleRow,
  line: number,
): Promise<{ res: RowResult; credit: CreatorCredit | null }> {
  const resolved = await resolveLink(c, row.affiliateShortCode);
  if (!resolved) {
    return { res: { line, externalId: row.externalId, status: 'error', message: 'short_code não encontrado' }, credit: null };
  }
  const res = await ingestConfirmedSale(c, {
    orgId,
    platform: row.platform,
    externalId: row.externalId,
    grossAmount: row.amount,
    commissionableAmount: row.commissionableAmount ?? null,
    occurredAt: row.soldAt ?? new Date().toISOString(),
    link: resolved.link,
    categoryId: resolved.categoryId,
    rawPayload: row,
  });
  if (res.duplicated) return { res: { line, externalId: row.externalId, status: 'duplicated' }, credit: null };
  if (res.entries === 0) {
    return { res: { line, externalId: row.externalId, status: 'no_rule', message: 'nenhuma regra de comissão aplicável' }, credit: null };
  }
  return { res: { line, externalId: row.externalId, status: 'imported' }, credit: res.creatorCredit };
}

// Parser CSV simples (template próprio documentado, sem campos com vírgula).
function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim());
  return { header, rows: lines.map((l) => l.split(',').map((v) => v.trim())) };
}

function rowFromCsv(header: string[], cols: string[]): unknown {
  const obj: Record<string, unknown> = {};
  header.forEach((h, i) => (obj[h] = cols[i]));
  return {
    platform: obj.platform,
    externalId: obj.externalId,
    affiliateShortCode: obj.affiliateShortCode,
    amount: obj.amount !== undefined ? Number(obj.amount) : undefined,
    commissionableAmount:
      obj.commissionableAmount !== undefined && obj.commissionableAmount !== ''
        ? Number(obj.commissionableAmount)
        : undefined,
    soldAt: obj.soldAt || undefined,
  };
}

@Controller()
class SalesController {
  constructor(
    private readonly pg: PgService,
    private readonly queues: QueuesService,
  ) {}

  // Notifica o creator sobre a comissão creditada (best-effort, fora da transação).
  private async notifyCredit(t: TenantContext, credit: CreatorCredit | null): Promise<void> {
    if (!credit) return;
    await notifyUser(this.pg, this.queues, t, {
      userId: credit.userId,
      template: 'commission_credited',
      body: `Você recebeu uma comissão de R$ ${credit.amount.toFixed(2)}.`,
      vars: { amount: credit.amount.toFixed(2) },
    });
  }

  // Venda avulsa (formulário manual). Roda o motor de comissão.
  @Post('affiliate-sales')
  @Roles('manager')
  async createOne(
    @CurrentTenant() t: TenantContext,
    @Body() body: unknown,
  ): Promise<RowResult> {
    const parsed = affiliateSaleRowSchema.safeParse(body);
    if (!parsed.success) {
      return { line: 1, status: 'error', message: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    if (!t.orgId) throw new Error('org ausente');
    const { res, credit } = await this.pg.withTenant(t, (c) => ingestRow(c, t.orgId as string, parsed.data, 1));
    await this.notifyCredit(t, credit);
    return res;
  }

  // Importação em lote (CSV: platform,externalId,affiliateShortCode,amount,commissionableAmount,soldAt).
  // Idempotente: re-upload não duplica (UNIQUE platform+external_id).
  @Post('affiliate-sales/import')
  @Roles('manager')
  async importCsv(
    @CurrentTenant() t: TenantContext,
    @Body() body: { csv?: string; rows?: unknown[] },
  ): Promise<{ imported: number; duplicated: number; failed: number; results: RowResult[] }> {
    if (!t.orgId) throw new Error('org ausente');
    const rawRows: unknown[] = [];
    if (body.csv) {
      const { header, rows } = parseCsv(body.csv);
      rawRows.push(...rows.map((cols) => rowFromCsv(header, cols)));
    } else if (Array.isArray(body.rows)) {
      rawRows.push(...body.rows);
    }

    const results: RowResult[] = [];
    // Cada linha em sua própria transação: uma falha não derruba o lote.
    for (let i = 0; i < rawRows.length; i++) {
      const line = i + 2; // +1 header, +1 base-1
      const parsed = affiliateSaleRowSchema.safeParse(rawRows[i]);
      if (!parsed.success) {
        results.push({ line, status: 'error', message: parsed.error.issues.map((x) => x.message).join('; ') });
        continue;
      }
      try {
        const { res, credit } = await this.pg.withTenant(t, (c) => ingestRow(c, t.orgId as string, parsed.data, line));
        results.push(res);
        await this.notifyCredit(t, credit);
      } catch (e) {
        results.push({ line, externalId: parsed.data.externalId, status: 'error', message: String(e).slice(0, 200) });
      }
    }
    return {
      imported: results.filter((r) => r.status === 'imported').length,
      duplicated: results.filter((r) => r.status === 'duplicated').length,
      failed: results.filter((r) => r.status === 'error' || r.status === 'no_rule').length,
      results,
    };
  }

  @Get('affiliate-sales')
  listSales(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, platform, external_id, status, gross_amount, commissionable_amount, occurred_at
             FROM openrate.affiliate_sales ORDER BY occurred_at DESC LIMIT 500`,
        )
        .then((r) => r.rows),
    );
  }

  // Extrato (livro-razão) de lançamentos de comissão.
  @Get('commission-entries')
  listEntries(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, affiliate_sale_id, beneficiary_type, user_id, store_id,
                  percentage, base_amount, amount, status, payable_at, reversal_of
             FROM openrate.commission_entries ORDER BY created_at DESC LIMIT 1000`,
        )
        .then((r) => r.rows),
    );
  }

  // Estorno de venda (cancelamento/devolução): lança espelhos negativos.
  @Post('affiliate-sales/:id/cancel')
  @Roles('manager')
  cancel(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    if (!t.orgId) throw new Error('org ausente');
    return this.pg.withTenant(t, async (c) => {
      const reversed = await reverseSale(c, id, t.orgId as string);
      return { saleId: id, reversedEntries: reversed };
    });
  }
}

@Module({ controllers: [SalesController] })
export class SalesModule {}
