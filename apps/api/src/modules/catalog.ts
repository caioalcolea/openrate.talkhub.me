import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';

// Brands, categories e video-types — apoio ao catálogo/conteúdo.

@Controller('brands')
class BrandsController {
  constructor(private readonly pg: PgService) {}
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT id, name, active FROM openrate.brands ORDER BY name').then((r) => r.rows),
    );
  }
  @Post()
  create(@CurrentTenant() t: TenantContext, @Body() b: { name: string }) {
    return this.pg.withTenant(t, (c) =>
      c
        .query('INSERT INTO openrate.brands (organization_id, name) VALUES ($1,$2) RETURNING *', [t.orgId, b.name])
        .then((r) => r.rows[0]),
    );
  }
}

@Controller('categories')
class CategoriesController {
  constructor(private readonly pg: PgService) {}
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT id, name, slug, parent_id FROM openrate.categories ORDER BY name').then((r) => r.rows),
    );
  }
  @Post()
  create(@CurrentTenant() t: TenantContext, @Body() b: { name: string; slug: string; parentId?: string }) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'INSERT INTO openrate.categories (organization_id, name, slug, parent_id) VALUES ($1,$2,$3,$4) RETURNING *',
          [t.orgId, b.name, b.slug, b.parentId ?? null],
        )
        .then((r) => r.rows[0]),
    );
  }
}

@Controller('video-types')
class VideoTypesController {
  constructor(private readonly pg: PgService) {}
  // Tipos globais (org null, seed da plataforma) + os da org.
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, name, slug, description, default_duration_seconds
             FROM openrate.video_types
            WHERE active = true AND (organization_id IS NULL OR organization_id = $1)
            ORDER BY name`,
          [t.orgId],
        )
        .then((r) => r.rows),
    );
  }
}

@Module({ controllers: [BrandsController, CategoriesController, VideoTypesController] })
export class CatalogModule {}
