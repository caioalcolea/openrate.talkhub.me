import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  generateIdeasSchema,
  type GenerateIdeasInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
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
  list(@CurrentTenant() t: TenantContext, @Param('id') productId: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, hook, script, caption, hashtags, target_duration_seconds, video_type_id, batch_id, used_count, archived
             FROM openrate.video_ideas
            WHERE product_id = $1 AND archived = false
            ORDER BY created_at DESC`,
          [productId],
        )
        .then((r) => r.rows),
    );
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
