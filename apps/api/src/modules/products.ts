import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createProductSchema,
  type CreateProductInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

@Controller('products')
class ProductsController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext, @Query('storeId') storeId?: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, name, scope, origin, store_id, category_id, brand_id, price, sku, active
             FROM openrate.products
            WHERE ($1::uuid IS NULL OR store_id = $1)
            ORDER BY name`,
          [storeId ?? null],
        )
        .then((r) => r.rows),
    );
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.products WHERE id = $1', [id]).then((r) => r.rows[0] ?? null),
    );
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductInput,
  ) {
    // scope=platform => produto global (org null, exige super_admin via RLS).
    // Demais escopos exigem uma org no contexto (evita 500 por CHECK/NOT NULL).
    if (dto.scope !== 'platform') assertOrgContext(t);
    const orgId = dto.scope === 'platform' ? null : t.orgId;
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.products
             (organization_id, store_id, scope, origin, name, description, sku, price, category_id, brand_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            orgId,
            dto.storeId ?? null,
            dto.scope,
            dto.origin,
            dto.name,
            dto.description ?? null,
            dto.sku ?? null,
            dto.price ?? null,
            dto.categoryId ?? null,
            dto.brandId ?? null,
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
    @Body() body: { name?: string; description?: string; price?: number; active?: boolean },
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.products
              SET name = COALESCE($2,name), description = COALESCE($3,description),
                  price = COALESCE($4,price), active = COALESCE($5,active)
            WHERE id = $1 RETURNING *`,
          [id, body.name ?? null, body.description ?? null, body.price ?? null, body.active ?? null],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [ProductsController] })
export class ProductsModule {}
