import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import {
  createStoreSchema,
  updateStoreSchema,
  type CreateStoreInput,
  type UpdateStoreInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Controller('stores')
class StoresController {
  constructor(private readonly pg: PgService) {}

  // RLS já filtra por org; managers veem a própria loja, owner vê todas da org.
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'SELECT id, name, slug, document, phone, whatsapp, address, timezone, active FROM openrate.stores ORDER BY name',
        )
        .then((r) => r.rows),
    );
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.stores WHERE id = $1', [id]).then((r) => r.rows[0] ?? null),
    );
  }

  @Post()
  @Roles('owner')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createStoreSchema)) dto: CreateStoreInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.stores
             (organization_id, name, slug, document, phone, whatsapp, address, timezone)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, COALESCE($8,'America/Sao_Paulo')) RETURNING *`,
          [
            t.orgId,
            dto.name,
            slugify(dto.name),
            dto.document ?? null,
            dto.phone ?? null,
            dto.whatsapp ?? null,
            JSON.stringify(dto.address ?? {}),
            dto.timezone ?? null,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }

  @Patch(':id')
  @Roles('owner')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStoreSchema)) dto: UpdateStoreInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.stores SET
             name     = COALESCE($2, name),
             document = COALESCE($3, document),
             phone    = COALESCE($4, phone),
             whatsapp = COALESCE($5, whatsapp),
             address  = COALESCE($6::jsonb, address),
             timezone = COALESCE($7, timezone),
             active   = COALESCE($8, active)
           WHERE id = $1 RETURNING *`,
          [
            id,
            dto.name ?? null,
            dto.document ?? null,
            dto.phone ?? null,
            dto.whatsapp ?? null,
            dto.address ? JSON.stringify(dto.address) : null,
            dto.timezone ?? null,
            dto.active ?? null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [StoresController] })
export class StoresModule {}
