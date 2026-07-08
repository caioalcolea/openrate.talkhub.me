import { Body, Controller, Module, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mediaUploadUrlSchema, type MediaUploadUrlInput, type TenantContext } from '@openrate/shared';
import { S3Service } from '../common/s3';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

// extensão a partir do content-type (fallback bin).
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

@Controller('media')
class MediaController {
  constructor(private readonly s3: S3Service) {}

  // Devolve uma URL pré-assinada para o browser fazer PUT direto da imagem, e a
  // key resultante (o cliente manda a key de volta no create do recurso).
  @Post('upload-url')
  @Roles('manager')
  async uploadUrl(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(mediaUploadUrlSchema)) dto: MediaUploadUrlInput,
  ): Promise<{ key: string; url: string }> {
    assertOrgContext(t);
    const ext = EXT[dto.contentType.toLowerCase()] ?? 'bin';
    const key = `assets/${t.orgId}/${dto.kind}/${randomUUID()}.${ext}`;
    const url = await this.s3.presignPut(key, dto.contentType);
    return { key, url };
  }
}

@Module({ controllers: [MediaController] })
export class MediaModule {}
