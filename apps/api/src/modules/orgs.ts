import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
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
      c.query('SELECT id, name, slug, document, active, created_at FROM openrate.organizations ORDER BY name').then((r) => r.rows),
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
          'INSERT INTO openrate.organizations (name, slug, document) VALUES ($1,$2,$3) RETURNING *',
          [dto.name, dto.slug, dto.document ?? null],
        )
        .then((r) => r.rows[0]),
    );
  }

  @Patch(':id')
  update(@CurrentTenant() t: TenantContext, @Param('id') id: string, @Body() body: { name?: string; active?: boolean }) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'UPDATE openrate.organizations SET name = COALESCE($2,name), active = COALESCE($3,active) WHERE id = $1 RETURNING *',
          [id, body.name ?? null, body.active ?? null],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [OrgsController] })
export class OrgsModule {}
