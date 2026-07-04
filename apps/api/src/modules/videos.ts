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
  startVideoUploadSchema,
  completeVideoUploadSchema,
  rejectVideoSchema,
  rawVideoKey,
  type StartVideoUploadInput,
  type CompleteVideoUploadInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { S3Service } from '../common/s3';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { QueuesService } from '../queues.service';
import { Roles } from '../auth/roles.decorator';

@Controller('videos')
class VideosController {
  constructor(
    private readonly pg: PgService,
    private readonly s3: S3Service,
    private readonly queues: QueuesService,
  ) {}

  // Inicia o upload: cria o registro e devolve presigned multipart. O vídeo
  // NÃO passa pela API — o browser envia as partes direto ao MinIO.
  @Post()
  async start(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(startVideoUploadSchema)) dto: StartVideoUploadInput,
  ) {
    if (!t.orgId || !t.storeId) throw new Error('org/loja ausentes no contexto');
    const videoId = randomUUID();
    const ext = dto.contentType.includes('webm') ? 'webm' : 'mp4';
    const key = rawVideoKey(t.orgId, t.storeId, videoId, ext);

    await this.pg.withTenant(t, (c) =>
      c.query(
        `INSERT INTO openrate.videos
           (id, organization_id, store_id, user_id, product_id, video_idea_id, status, raw_key, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,'recording',$7,$8)`,
        [videoId, t.orgId, t.storeId, t.userId, dto.productId, dto.videoIdeaId, key, dto.fileSize],
      ),
    );

    const uploadId = await this.s3.createMultipart(key, dto.contentType);
    const parts = await this.s3.presignParts(key, uploadId, dto.partCount);
    return { videoId, uploadId, key, parts };
  }

  @Post(':id/complete-upload')
  @HttpCode(202)
  async complete(
    @CurrentTenant() t: TenantContext,
    @Param('id') videoId: string,
    @Body(new ZodValidationPipe(completeVideoUploadSchema)) dto: CompleteVideoUploadInput,
  ) {
    const key = await this.pg.withTenant(t, async (c) => {
      const r = await c.query('SELECT raw_key FROM openrate.videos WHERE id = $1', [videoId]);
      if ((r.rowCount ?? 0) === 0) throw new Error('vídeo não encontrado');
      return r.rows[0].raw_key as string;
    });

    await this.s3.completeMultipart(key, dto.uploadId, dto.parts);

    await this.pg.withTenant(t, (c) =>
      c.query(
        `UPDATE openrate.videos SET status = 'processing', uploaded_at = now() WHERE id = $1`,
        [videoId],
      ),
    );

    if (!t.orgId) throw new Error('org ausente');
    await this.queues.enqueueVideoProcessing({
      orgId: t.orgId,
      storeId: t.storeId,
      userId: t.userId,
      correlationId: t.correlationId,
      videoId,
      rawKey: key,
    });
    return { videoId, status: 'processing' };
  }

  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, product_id, status, duration_seconds, thumb_key, created_at, approved_at
             FROM openrate.videos ORDER BY created_at DESC LIMIT 200`,
        )
        .then((r) => r.rows),
    );
  }

  @Get(':id')
  async get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    const video = await this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.videos WHERE id = $1', [id]).then((r) => r.rows[0] ?? null),
    );
    if (!video) return null;
    const finalUrl = video.final_key ? await this.s3.presignGet(video.final_key) : null;
    const thumbUrl = video.thumb_key ? await this.s3.presignGet(video.thumb_key) : null;
    return { ...video, finalUrl, thumbUrl };
  }

  @Post(':id/approve')
  @Roles('manager')
  approve(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.videos SET status = 'approved', approved_at = now(), approved_by = $2
             WHERE id = $1 AND status = 'ready' RETURNING id, status`,
          [id, t.userId],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }

  @Post(':id/reject')
  @Roles('manager')
  reject(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectVideoSchema)) dto: { reason: string },
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.videos SET status = 'rejected', rejected_reason = $2
             WHERE id = $1 RETURNING id, status`,
          [id, dto.reason],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [VideosController] })
export class VideosModule {}
