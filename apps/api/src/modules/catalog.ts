import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import {
  createBrandSchema,
  updateBrandSchema,
  createCategorySchema,
  updateCategorySchema,
  createVideoTypeSchema,
  updateVideoTypeSchema,
  type CreateBrandInput,
  type UpdateBrandInput,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  type CreateVideoTypeInput,
  type UpdateVideoTypeInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { S3Service } from '../common/s3';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

// Brands, categories e video-types — apoio ao catálogo/conteúdo.

@Controller('brands')
class BrandsController {
  constructor(
    private readonly pg: PgService,
    private readonly s3: S3Service,
  ) {}

  @Get()
  async list(@CurrentTenant() t: TenantContext) {
    const rows = await this.pg.withTenant(t, (c) =>
      c
        .query<{ id: string; name: string; logo_key: string | null; active: boolean }>(
          'SELECT id, name, logo_key, active FROM openrate.brands WHERE active = true ORDER BY name',
        )
        .then((r) => r.rows),
    );
    return Promise.all(
      rows.map(async (b) => ({ ...b, logoUrl: b.logo_key ? await this.s3.presignGet(b.logo_key) : null })),
    );
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createBrandSchema)) dto: CreateBrandInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query('INSERT INTO openrate.brands (organization_id, name, logo_key) VALUES ($1,$2,$3) RETURNING *', [
          t.orgId,
          dto.name,
          dto.logoKey ?? null,
        ])
        .then((r) => r.rows[0]),
    );
  }

  @Patch(':id')
  @Roles('manager')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBrandSchema)) dto: UpdateBrandInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.brands SET
             name     = COALESCE($2, name),
             logo_key = COALESCE($3, logo_key),
             active   = COALESCE($4, active)
           WHERE id = $1 RETURNING *`,
          [id, dto.name ?? null, dto.logoKey ?? null, dto.active ?? null],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Controller('categories')
class CategoriesController {
  constructor(private readonly pg: PgService) {}
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query('SELECT id, name, slug, parent_id, active FROM openrate.categories WHERE active = true ORDER BY name')
        .then((r) => r.rows),
    );
  }
  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createCategorySchema)) dto: CreateCategoryInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'INSERT INTO openrate.categories (organization_id, name, slug, parent_id) VALUES ($1,$2,$3,$4) RETURNING *',
          [t.orgId, dto.name, dto.slug, dto.parentId ?? null],
        )
        .then((r) => r.rows[0]),
    );
  }
  @Patch(':id')
  @Roles('manager')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) dto: UpdateCategoryInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.categories SET
             name      = COALESCE($2, name),
             slug      = COALESCE($3, slug),
             parent_id = COALESCE($4, parent_id),
             active    = COALESCE($5, active)
           WHERE id = $1 RETURNING *`,
          [id, dto.name ?? null, dto.slug ?? null, dto.parentId ?? null, dto.active ?? null],
        )
        .then((r) => r.rows[0] ?? null),
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
          `SELECT id, name, slug, icon, description, prompt_template, default_duration_seconds,
                  script_skeleton, organization_id
             FROM openrate.video_types
            WHERE active = true AND (organization_id IS NULL OR organization_id = $1)
            ORDER BY name`,
          [t.orgId],
        )
        .then((r) => r.rows),
    );
  }
  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createVideoTypeSchema)) dto: CreateVideoTypeInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.video_types
             (organization_id, name, slug, icon, description, prompt_template, default_duration_seconds, script_skeleton)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
          [
            t.orgId,
            dto.name,
            dto.slug,
            dto.icon ?? null,
            dto.description ?? null,
            dto.promptTemplate ?? null,
            dto.defaultDurationSeconds ?? null,
            JSON.stringify(dto.scriptSkeleton ?? []),
          ],
        )
        .then((r) => r.rows[0]),
    );
  }
  // Só edita os da própria org (RLS isola; os globais org-null não pertencem ao tenant).
  @Patch(':id')
  @Roles('manager')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVideoTypeSchema)) dto: UpdateVideoTypeInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.video_types SET
             name = COALESCE($2, name),
             icon = COALESCE($3, icon),
             description = COALESCE($4, description),
             prompt_template = COALESCE($5, prompt_template),
             default_duration_seconds = COALESCE($6, default_duration_seconds),
             script_skeleton = COALESCE($7::jsonb, script_skeleton),
             active = COALESCE($8, active)
           WHERE id = $1 AND organization_id = $9 RETURNING *`,
          [
            id,
            dto.name ?? null,
            dto.icon ?? null,
            dto.description ?? null,
            dto.promptTemplate ?? null,
            dto.defaultDurationSeconds ?? null,
            dto.scriptSkeleton ? JSON.stringify(dto.scriptSkeleton) : null,
            dto.active ?? null,
            t.orgId,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [BrandsController, CategoriesController, VideoTypesController] })
export class CatalogModule {}
