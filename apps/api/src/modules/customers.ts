import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

// CRM da loja física. RLS isola por org; store_id opcional (cliente pode ser da rede).
@Controller('customers')
class CustomersController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(
    @CurrentTenant() t: TenantContext,
    @Query('storeId') storeId?: string,
    @Query('q') q?: string,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, name, document, email, phone, whatsapp, origin, tags, lgpd_consent, store_id, created_at
             FROM openrate.customers
            WHERE ($1::uuid IS NULL OR store_id = $1)
              AND ($2::text IS NULL OR name ILIKE '%'||$2||'%' OR document ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
            ORDER BY name`,
          [storeId ?? null, q ?? null],
        )
        .then((r) => r.rows),
    );
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.customers WHERE id = $1', [id]).then((r) => r.rows[0] ?? null),
    );
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.customers
             (organization_id, store_id, name, document, email, phone, whatsapp, birthdate,
              gender, address, origin, tags, lgpd_consent, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,COALESCE($13,false),$14) RETURNING *`,
          [
            t.orgId,
            dto.storeId ?? null,
            dto.name,
            dto.document ?? null,
            dto.email ?? null,
            dto.phone ?? null,
            dto.whatsapp ?? null,
            dto.birthdate ?? null,
            dto.gender ?? null,
            JSON.stringify(dto.address ?? {}),
            dto.origin ?? null,
            dto.tags ?? [],
            dto.lgpdConsent ?? null,
            dto.notes ?? null,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }

  @Patch(':id')
  @Roles('manager')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.customers SET
             name = COALESCE($2, name), document = COALESCE($3, document),
             email = COALESCE($4, email), phone = COALESCE($5, phone), whatsapp = COALESCE($6, whatsapp),
             birthdate = COALESCE($7, birthdate), gender = COALESCE($8, gender),
             address = COALESCE($9::jsonb, address), origin = COALESCE($10, origin),
             tags = COALESCE($11::text[], tags), lgpd_consent = COALESCE($12, lgpd_consent),
             notes = COALESCE($13, notes), store_id = COALESCE($14, store_id)
           WHERE id = $1 RETURNING *`,
          [
            id,
            dto.name ?? null,
            dto.document ?? null,
            dto.email ?? null,
            dto.phone ?? null,
            dto.whatsapp ?? null,
            dto.birthdate ?? null,
            dto.gender ?? null,
            dto.address ? JSON.stringify(dto.address) : null,
            dto.origin ?? null,
            dto.tags ?? null,
            dto.lgpdConsent ?? null,
            dto.notes ?? null,
            dto.storeId ?? null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [CustomersController] })
export class CustomersModule {}
