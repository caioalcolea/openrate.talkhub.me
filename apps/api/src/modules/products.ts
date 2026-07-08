import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  createProductSchema,
  updateProductSchema,
  createProductImageSchema,
  createProductVariationSchema,
  upsertStoreInventorySchema,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateProductImageInput,
  type CreateProductVariationInput,
  type UpsertStoreInventoryInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { S3Service } from '../common/s3';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

// Normaliza os links de marketplace: descarta vazios/ausentes; undefined se sobrar nenhum.
function cleanMarketplaceLinks(
  links?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  if (!links) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(links)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? out : undefined;
}

@Controller('products')
class ProductsController {
  constructor(
    private readonly pg: PgService,
    private readonly s3: S3Service,
  ) {}

  // Lê a org do produto (garante que ele é visível ao tenant); 404 caso contrário.
  private async productOrg(c: PoolClient, id: string): Promise<string | null> {
    const r = await c.query<{ organization_id: string | null }>(
      'SELECT organization_id FROM openrate.products WHERE id = $1',
      [id],
    );
    if (r.rowCount === 0) throw new NotFoundException('produto não encontrado');
    return r.rows[0].organization_id;
  }

  @Get()
  async list(
    @CurrentTenant() t: TenantContext,
    @Query('storeId') storeId?: string,
    @Query('scope') scope?: string,
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('q') q?: string,
    @Query('active') active?: string,
  ) {
    const rows = await this.pg.withTenant(t, (c) =>
      c
        .query<{ id: string; thumb_key: string | null } & Record<string, unknown>>(
          `SELECT id, name, scope, store_id, brand_id, category_id, price, sku, active,
                  (SELECT storage_key FROM openrate.product_images pi
                    WHERE pi.product_id = p.id ORDER BY is_primary DESC, position LIMIT 1) AS thumb_key
             FROM openrate.products p
            WHERE ($1::uuid IS NULL OR store_id = $1)
              AND ($2::text IS NULL OR scope::text = $2)
              AND ($3::uuid IS NULL OR brand_id = $3)
              AND ($4::uuid IS NULL OR category_id = $4)
              AND ($5::text IS NULL OR name ILIKE '%' || $5 || '%' OR sku ILIKE '%' || $5 || '%')
              AND ($6::boolean IS NULL OR active = $6)
            ORDER BY name`,
          [
            storeId ?? null,
            scope ?? null,
            brandId ?? null,
            categoryId ?? null,
            q ?? null,
            active === undefined ? null : active === 'true',
          ],
        )
        .then((r) => r.rows),
    );
    return Promise.all(
      rows.map(async ({ thumb_key, ...p }) => ({
        ...p,
        thumbUrl: thumb_key ? await this.s3.presignGet(thumb_key) : null,
      })),
    );
  }

  @Get(':id')
  async get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    const data = await this.pg.withTenant(t, async (c) => {
      const product = (await c.query('SELECT * FROM openrate.products WHERE id = $1', [id])).rows[0];
      if (!product) return null;
      const images = (
        await c.query(
          `SELECT id, storage_key, alt, position, is_primary FROM openrate.product_images
            WHERE product_id = $1 ORDER BY is_primary DESC, position`,
          [id],
        )
      ).rows;
      const variations = (
        await c.query(
          `SELECT id, name, sku, price, attributes, active FROM openrate.product_variations
            WHERE product_id = $1 ORDER BY name`,
          [id],
        )
      ).rows;
      const inventory = (
        await c.query(
          `SELECT si.id, si.store_id, s.name AS store_name, si.variation_id, si.quantity,
                  si.price_override, si.available
             FROM openrate.store_inventory si JOIN openrate.stores s ON s.id = si.store_id
            WHERE si.product_id = $1 ORDER BY s.name`,
          [id],
        )
      ).rows;
      return { product, images, variations, inventory };
    });
    if (!data) throw new NotFoundException('produto não encontrado');
    const images = await Promise.all(
      data.images.map(async (im: { storage_key: string }) => ({
        ...im,
        url: await this.s3.presignGet(im.storage_key),
      })),
    );
    return { ...data, images };
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductInput,
  ) {
    // Regras de escopo (respeita os CHECKs de products; erro claro em vez de 500).
    if (dto.scope === 'platform') {
      if (t.role !== 'super_admin') throw new ForbiddenException('apenas super_admin cria produto de plataforma');
    } else {
      assertOrgContext(t);
      if (dto.scope === 'store' && !dto.storeId) {
        throw new BadRequestException('produto de loja exige uma loja (storeId)');
      }
    }
    const orgId = dto.scope === 'platform' ? null : t.orgId;
    const storeId = dto.scope === 'store' ? dto.storeId ?? null : null;
    const marketplaceLinks = cleanMarketplaceLinks(dto.marketplaceLinks);
    const attributes = marketplaceLinks ? { marketplaceLinks } : {};
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.products
             (organization_id, store_id, scope, origin, name, model, product_type, unit, sku, gtin,
              ncm, cest, fiscal_origin, price, promo_price, cost_price, short_description, description,
              tags, seo_title, seo_description, institutional_video_url, weight_gross_kg, weight_net_kg,
              height_cm, width_cm, length_cm, items_per_box, brand_id, category_id, attributes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb)
           RETURNING *`,
          [
            orgId,
            storeId,
            dto.scope,
            dto.origin,
            dto.name,
            dto.model ?? null,
            dto.productType ?? 'simple',
            dto.unit ?? null,
            dto.sku ?? null,
            dto.gtin ?? null,
            dto.ncm ?? null,
            dto.cest ?? null,
            dto.fiscalOrigin ?? null,
            dto.price ?? null,
            dto.promoPrice ?? null,
            dto.costPrice ?? null,
            dto.shortDescription ?? null,
            dto.description ?? null,
            dto.tags ?? [],
            dto.seoTitle ?? null,
            dto.seoDescription ?? null,
            dto.institutionalVideoUrl ?? null,
            dto.weightGrossKg ?? null,
            dto.weightNetKg ?? null,
            dto.heightCm ?? null,
            dto.widthCm ?? null,
            dto.lengthCm ?? null,
            dto.itemsPerBox ?? null,
            dto.brandId ?? null,
            dto.categoryId ?? null,
            JSON.stringify(attributes),
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
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductInput,
  ) {
    // Não altera scope/store/org/origin (mudá-los quebraria os CHECKs de tenancy).
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.products SET
             name = COALESCE($2, name), model = COALESCE($3, model),
             product_type = COALESCE($4, product_type), unit = COALESCE($5, unit),
             sku = COALESCE($6, sku), gtin = COALESCE($7, gtin),
             ncm = COALESCE($8, ncm), cest = COALESCE($9, cest), fiscal_origin = COALESCE($10, fiscal_origin),
             price = COALESCE($11, price), promo_price = COALESCE($12, promo_price), cost_price = COALESCE($13, cost_price),
             short_description = COALESCE($14, short_description), description = COALESCE($15, description),
             tags = COALESCE($16::text[], tags),
             seo_title = COALESCE($17, seo_title), seo_description = COALESCE($18, seo_description),
             institutional_video_url = COALESCE($19, institutional_video_url),
             weight_gross_kg = COALESCE($20, weight_gross_kg), weight_net_kg = COALESCE($21, weight_net_kg),
             height_cm = COALESCE($22, height_cm), width_cm = COALESCE($23, width_cm), length_cm = COALESCE($24, length_cm),
             items_per_box = COALESCE($25, items_per_box),
             brand_id = COALESCE($26, brand_id), category_id = COALESCE($27, category_id),
             attributes = CASE WHEN $29::jsonb IS NULL THEN attributes
                               ELSE attributes || jsonb_build_object('marketplaceLinks', $29::jsonb) END,
             active = COALESCE($28, active)
           WHERE id = $1 RETURNING *`,
          [
            id,
            dto.name ?? null,
            dto.model ?? null,
            dto.productType ?? null,
            dto.unit ?? null,
            dto.sku ?? null,
            dto.gtin ?? null,
            dto.ncm ?? null,
            dto.cest ?? null,
            dto.fiscalOrigin ?? null,
            dto.price ?? null,
            dto.promoPrice ?? null,
            dto.costPrice ?? null,
            dto.shortDescription ?? null,
            dto.description ?? null,
            dto.tags ?? null,
            dto.seoTitle ?? null,
            dto.seoDescription ?? null,
            dto.institutionalVideoUrl ?? null,
            dto.weightGrossKg ?? null,
            dto.weightNetKg ?? null,
            dto.heightCm ?? null,
            dto.widthCm ?? null,
            dto.lengthCm ?? null,
            dto.itemsPerBox ?? null,
            dto.brandId ?? null,
            dto.categoryId ?? null,
            dto.active ?? null,
            dto.marketplaceLinks !== undefined
              ? JSON.stringify(cleanMarketplaceLinks(dto.marketplaceLinks) ?? {})
              : null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }

  // ---- Imagens ----
  @Post(':id/images')
  @Roles('manager')
  async addImage(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createProductImageSchema)) dto: CreateProductImageInput,
  ) {
    return this.pg.withTenant(t, async (c) => {
      const org = await this.productOrg(c, id);
      if (dto.isPrimary) {
        await c.query('UPDATE openrate.product_images SET is_primary = false WHERE product_id = $1', [id]);
      }
      const r = await c.query(
        `INSERT INTO openrate.product_images (organization_id, product_id, storage_key, alt, position, is_primary)
         VALUES ($1,$2,$3,$4,COALESCE($5,0),COALESCE($6,false)) RETURNING id, storage_key, alt, position, is_primary`,
        [org, id, dto.storageKey, dto.alt ?? null, dto.position ?? null, dto.isPrimary ?? null],
      );
      const im = r.rows[0];
      return { ...im, url: await this.s3.presignGet(im.storage_key) };
    });
  }

  @Post(':id/images/:imageId/primary')
  @Roles('manager')
  setPrimary(@CurrentTenant() t: TenantContext, @Param('id') id: string, @Param('imageId') imageId: string) {
    return this.pg.withTenant(t, async (c) => {
      const r = await c.query(
        'UPDATE openrate.product_images SET is_primary = (id = $2) WHERE product_id = $1 RETURNING id, is_primary',
        [id, imageId],
      );
      return { ok: (r.rowCount ?? 0) > 0 };
    });
  }

  @Delete(':id/images/:imageId')
  @Roles('manager')
  deleteImage(@CurrentTenant() t: TenantContext, @Param('id') id: string, @Param('imageId') imageId: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query('DELETE FROM openrate.product_images WHERE id = $2 AND product_id = $1', [id, imageId])
        .then((r) => ({ ok: (r.rowCount ?? 0) > 0 })),
    );
  }

  // ---- Variações ----
  @Post(':id/variations')
  @Roles('manager')
  addVariation(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createProductVariationSchema)) dto: CreateProductVariationInput,
  ) {
    return this.pg.withTenant(t, async (c) => {
      const org = await this.productOrg(c, id);
      const r = await c.query(
        `INSERT INTO openrate.product_variations (organization_id, product_id, name, sku, price, attributes, active)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,COALESCE($7,true)) RETURNING id, name, sku, price, attributes, active`,
        [org, id, dto.name, dto.sku ?? null, dto.price ?? null, JSON.stringify(dto.attributes ?? {}), dto.active ?? null],
      );
      return r.rows[0];
    });
  }

  @Patch(':id/variations/:vid')
  @Roles('manager')
  updateVariation(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Param('vid') vid: string,
    @Body(new ZodValidationPipe(createProductVariationSchema.partial())) dto: Partial<CreateProductVariationInput>,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.product_variations SET
             name = COALESCE($3, name), sku = COALESCE($4, sku), price = COALESCE($5, price),
             attributes = COALESCE($6::jsonb, attributes), active = COALESCE($7, active)
           WHERE id = $2 AND product_id = $1 RETURNING id, name, sku, price, attributes, active`,
          [
            id,
            vid,
            dto.name ?? null,
            dto.sku ?? null,
            dto.price ?? null,
            dto.attributes ? JSON.stringify(dto.attributes) : null,
            dto.active ?? null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }

  @Delete(':id/variations/:vid')
  @Roles('manager')
  deleteVariation(@CurrentTenant() t: TenantContext, @Param('id') id: string, @Param('vid') vid: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query('DELETE FROM openrate.product_variations WHERE id = $2 AND product_id = $1', [id, vid])
        .then((r) => ({ ok: (r.rowCount ?? 0) > 0 })),
    );
  }

  // ---- Estoque por loja (upsert) ----
  @Post(':id/inventory')
  @Roles('manager')
  upsertInventory(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertStoreInventorySchema)) dto: UpsertStoreInventoryInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, async (c) => {
      await this.productOrg(c, id); // valida visibilidade do produto (404 se não)
      const r = await c.query(
        `INSERT INTO openrate.store_inventory
           (organization_id, store_id, product_id, variation_id, quantity, price_override, available)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true))
         ON CONFLICT (store_id, product_id, variation_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, price_override = EXCLUDED.price_override,
                       available = EXCLUDED.available
         RETURNING id, store_id, product_id, variation_id, quantity, price_override, available`,
        [t.orgId, dto.storeId, id, dto.variationId ?? null, dto.quantity, dto.priceOverride ?? null, dto.available ?? null],
      );
      return r.rows[0];
    });
  }
}

@Module({ controllers: [ProductsController] })
export class ProductsModule {}
