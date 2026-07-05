import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  createPublicationSchema,
  roleAtLeast,
  type CreatePublicationInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant, Public } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { env } from '../common/env';

// Código curto do link de afiliado (nunca reciclado — unique total no banco).
function shortCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

@Controller()
class PublicationsController {
  constructor(private readonly pg: PgService) {}

  // Registra "publiquei este vídeo na plataforma X" e cria o link de afiliado.
  // Só vídeos aprovados podem ser publicados (gate do MVP).
  @Post('videos/:id/publications')
  async create(
    @CurrentTenant() t: TenantContext,
    @Param('id') videoId: string,
    @Body(new ZodValidationPipe(createPublicationSchema)) dto: CreatePublicationInput,
  ) {
    return this.pg.withTenant(t, async (c) => {
      const v = await c.query(
        'SELECT id, user_id, store_id, product_id, status FROM openrate.videos WHERE id = $1',
        [videoId],
      );
      if ((v.rowCount ?? 0) === 0) throw new NotFoundException('vídeo não encontrado');
      const video = v.rows[0];
      // Atendente só publica o PRÓPRIO vídeo; manager/owner publicam qualquer um da org.
      if (!roleAtLeast(t.role, 'manager') && video.user_id !== t.userId) {
        throw new ForbiddenException('você só pode publicar seus próprios vídeos');
      }
      if (video.status !== 'approved') {
        throw new NotFoundException('vídeo não está aprovado para publicação');
      }

      const pub = await c.query(
        `INSERT INTO openrate.video_publications
           (organization_id, video_id, platform, status, external_url, caption, published_at)
         VALUES ($1,$2,$3,'published',$4,$5, now()) RETURNING *`,
        [t.orgId, videoId, dto.platform, dto.externalUrl ?? null, dto.caption ?? null],
      );

      const code = shortCode();
      const link = await c.query(
        `INSERT INTO openrate.affiliate_links
           (organization_id, store_id, user_id, product_id, video_publication_id, platform,
            short_code, destination_url, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, true) RETURNING id, short_code`,
        [
          t.orgId,
          video.store_id,
          video.user_id,
          video.product_id,
          pub.rows[0].id,
          dto.platform,
          code,
          dto.destinationUrl,
        ],
      );

      return {
        publication: pub.rows[0],
        affiliateLink: {
          id: link.rows[0].id,
          shortCode: code,
          redirectUrl: `${env.apiPublicUrl}/r/${code}`,
        },
      };
    });
  }

  @Get('publications')
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT p.id, p.video_id, p.platform, p.status, p.external_url, p.caption, p.published_at,
                  l.short_code, l.clicks_count, l.destination_url,
                  pr.name AS product_name, u.full_name AS creator_name
             FROM openrate.video_publications p
             LEFT JOIN openrate.affiliate_links l ON l.video_publication_id = p.id
             LEFT JOIN openrate.videos v ON v.id = p.video_id
             LEFT JOIN openrate.products pr ON pr.id = v.product_id
             LEFT JOIN openrate.users u ON u.id = v.user_id
            ORDER BY p.created_at DESC LIMIT 500`,
        )
        .then((r) =>
          r.rows.map((row) => ({
            ...row,
            // Link público do redirecionador (fora de /v1). Facilita copiar/colar no painel.
            redirect_url: row.short_code ? `${env.apiPublicUrl}/r/${row.short_code}` : null,
          })),
        ),
    );
  }
}

// Redirecionador público do link de afiliado (fora do prefixo /v1 — ver main.ts).
@Controller()
class RedirectController {
  constructor(private readonly pg: PgService) {}

  @Public()
  @Get('r/:code')
  async redirect(@Param('code') code: string, @Res() res: Response): Promise<void> {
    // Link público, cross-tenant e sem claim de org: usa a função SECURITY
    // DEFINER (migration 0002), que contorna o RLS de forma controlada —
    // resolve por código exato e incrementa cliques, sem enumerar links.
    const r = await this.pg.query<{ url: string | null }>(
      'SELECT openrate.click_affiliate_link($1) AS url',
      [code],
    );
    const url = r.rows[0]?.url;
    if (!url) {
      res.status(404).send('Link inválido ou desativado.');
      return;
    }
    res.redirect(302, url);
  }
}

@Module({ controllers: [PublicationsController, RedirectController] })
export class PublicationsModule {}
