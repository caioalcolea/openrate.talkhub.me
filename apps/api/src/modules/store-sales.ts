import { BadRequestException, Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import {
  createStoreSaleSchema,
  type CreateStoreSaleInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

// Venda da loja FÍSICA (performance offline do atendente / CRM). NÃO gera comissão
// de afiliado — isso é exclusivo de affiliate_sales. RLS isola por org.
@Controller('store-sales')
class StoreSalesController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext, @Query('storeId') storeId?: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT ss.id, ss.total_amount, ss.items, ss.source, ss.occurred_at,
                  s.name AS store_name, cu.name AS customer_name, u.full_name AS user_name
             FROM openrate.store_sales ss
             JOIN openrate.stores s ON s.id = ss.store_id
             LEFT JOIN openrate.customers cu ON cu.id = ss.customer_id
             LEFT JOIN openrate.users u ON u.id = ss.user_id
            WHERE ($1::uuid IS NULL OR ss.store_id = $1)
            ORDER BY ss.occurred_at DESC
            LIMIT 500`,
          [storeId ?? null],
        )
        .then((r) => r.rows),
    );
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createStoreSaleSchema)) dto: CreateStoreSaleInput,
  ) {
    assertOrgContext(t);
    if (!dto.storeId) throw new BadRequestException('a venda física exige uma loja (storeId)');
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.store_sales
             (organization_id, store_id, customer_id, user_id, total_amount, items, source, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,'manual', COALESCE($7::timestamptz, now())) RETURNING *`,
          [
            t.orgId,
            dto.storeId,
            dto.customerId ?? null,
            dto.userId ?? null,
            dto.totalAmount,
            JSON.stringify(dto.items ?? []),
            dto.occurredAt ?? null,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }
}

@Module({ controllers: [StoreSalesController] })
export class StoreSalesModule {}
