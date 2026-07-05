import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

@Controller('orgs')
@Roles('super_admin')
class OrgsController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'SELECT id, name, trade_name, slug, document, plan, status, active, created_at FROM openrate.organizations ORDER BY name',
        )
        .then((r) => r.rows),
    );
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.organizations WHERE id = $1', [id]).then((r) => r.rows[0] ?? null),
    );
  }

  @Post()
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createOrganizationSchema)) dto: CreateOrganizationInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.organizations (name, slug, document, trade_name, plan)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [dto.name, dto.slug, dto.document ?? null, dto.tradeName ?? null, dto.plan ?? 'free'],
        )
        .then((r) => r.rows[0]),
    );
  }

  @Patch(':id')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) dto: UpdateOrganizationInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.organizations SET
             name       = COALESCE($2, name),
             trade_name = COALESCE($3, trade_name),
             document   = COALESCE($4, document),
             plan       = COALESCE($5, plan),
             status     = COALESCE($6, status),
             active     = COALESCE($7, active)
           WHERE id = $1 RETURNING *`,
          [
            id,
            dto.name ?? null,
            dto.tradeName ?? null,
            dto.document ?? null,
            dto.plan ?? null,
            dto.status ?? null,
            dto.active ?? null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [OrgsController] })
export class OrgsModule {}
