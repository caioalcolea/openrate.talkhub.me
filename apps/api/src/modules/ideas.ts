import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  generateIdeasSchema,
  createIdeaSchema,
  updateIdeaSchema,
  type GenerateIdeasInput,
  type CreateIdeaInput,
  type UpdateIdeaInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { QueuesService } from '../queues.service';

@Controller()
class IdeasController {
  constructor(
    private readonly pg: PgService,
    private readonly queues: QueuesService,
  ) {}

  // Enfileira a geração das 40 ideias (roda no worker via Claude).
  @Post('products/:id/generate-ideas')
  @HttpCode(202)
  async generate(
    @CurrentTenant() t: TenantContext,
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(generateIdeasSchema)) dto: GenerateIdeasInput,
  ): Promise<{ batchId: string; status: string }> {
    const batchId = randomUUID();
    if (!t.orgId) throw new Error('org_id ausente no contexto');
    await this.queues.enqueueAiScript(
      {
        orgId: t.orgId,
        storeId: t.storeId,
        userId: t.userId,
        correlationId: t.correlationId,
        productId,
        videoTypeId: dto.videoTypeId,
        batchId,
        count: dto.count,
      },
      dto.regenerate ? Date.now() % 1000 : 0,
    );
    return { batchId, status: 'queued' };
  }

  @Get('products/:id/ideas')
  list(
    @CurrentTenant() t: TenantContext,
    @Param('id') productId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const withArchived = includeArchived === 'true';
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, hook, script, caption, hashtags, target_duration_seconds, video_type_id,
                  batch_id, source, used_count, archived
             FROM openrate.video_ideas
            WHERE product_id = $1 AND ($2::boolean OR archived = false)
            ORDER BY created_at DESC`,
          [productId, withArchived],
        )
        .then((r) => r.rows),
    );
  }

  // Ideia MANUAL: mesmos campos que a IA gera, marcada como source='manual'.
  @Post('products/:id/ideas')
  @Roles('manager')
  createManual(
    @CurrentTenant() t: TenantContext,
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(createIdeaSchema)) dto: CreateIdeaInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.video_ideas
             (organization_id, product_id, video_type_id, hook, script, caption, hashtags,
              target_duration_seconds, source)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'manual') RETURNING *`,
          [
            t.orgId,
            productId,
            dto.videoTypeId ?? null,
            dto.hook,
            JSON.stringify(dto.script),
            dto.caption ?? null,
            dto.hashtags ?? [],
            dto.targetDurationSeconds ?? null,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }

  // Editar/arquivar uma ideia (COALESCE dos campos + archived).
  @Patch('ideas/:id')
  @Roles('manager')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIdeaSchema)) dto: UpdateIdeaInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.video_ideas SET
             hook = COALESCE($2, hook),
             script = COALESCE($3::jsonb, script),
             caption = COALESCE($4, caption),
             hashtags = COALESCE($5::text[], hashtags),
             target_duration_seconds = COALESCE($6, target_duration_seconds),
             video_type_id = COALESCE($7, video_type_id),
             archived = COALESCE($8, archived)
           WHERE id = $1 RETURNING *`,
          [
            id,
            dto.hook ?? null,
            dto.script ? JSON.stringify(dto.script) : null,
            dto.caption ?? null,
            dto.hashtags ?? null,
            dto.targetDurationSeconds ?? null,
            dto.videoTypeId ?? null,
            dto.archived ?? null,
          ],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }

  // Duplicar e adaptar: cria uma cópia MANUAL (used_count 0, não arquivada).
  @Post('ideas/:id/duplicate')
  @Roles('manager')
  duplicate(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, async (c) => {
      const r = await c.query(
        `INSERT INTO openrate.video_ideas
           (organization_id, product_id, video_type_id, hook, script, caption, hashtags,
            target_duration_seconds, source)
         SELECT organization_id, product_id, video_type_id, hook || ' (cópia)', script, caption,
                hashtags, target_duration_seconds, 'manual'
           FROM openrate.video_ideas WHERE id = $1
         RETURNING *`,
        [id],
      );
      if ((r.rowCount ?? 0) === 0) throw new NotFoundException('ideia não encontrada');
      return r.rows[0];
    });
  }

  // Atendente escolhe a ideia → incrementa uso (o app então vai gravar).
  @Post('ideas/:id/select')
  select(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'UPDATE openrate.video_ideas SET used_count = used_count + 1 WHERE id = $1 RETURNING *',
          [id],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [IdeasController] })
export class IdeasModule {}
