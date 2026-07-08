import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import type { TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { QueuesService } from '../queues.service';
import { CurrentTenant } from '../common/tenant';
import { Roles } from '../auth/roles.decorator';
import { env } from '../common/env';

// Seams das integrações da fase Escala (Asaas/Olist/metrics-sync). Os disparos
// enfileiram jobs cujos processadores são STUBS no worker até a fase ser puxada;
// enquanto a credencial não existe, respondem 501 (não habilitado).
@Controller('integrations')
class IntegrationsController {
  constructor(
    private readonly pg: PgService,
    private readonly queues: QueuesService,
  ) {}

  // Janela horária para o jobId determinístico (dedup dentro da mesma hora).
  private hourWindow(): string {
    return new Date().toISOString().slice(0, 13);
  }

  @Get()
  @Roles('manager')
  status(): { asaas: boolean; olist: boolean; metricsSync: boolean } {
    return {
      asaas: env.integrations.asaas,
      olist: env.integrations.olist,
      metricsSync: env.integrations.metricsSync,
    };
  }

  // Dispara a coleta de métricas (views/likes) das publicações no ar. Métricas
  // são best-effort e NUNCA alimentam o financeiro (só affiliate_sales).
  @Post('metrics/sync')
  @Roles('manager')
  async metricsSync(@CurrentTenant() t: TenantContext): Promise<{ enqueued: number }> {
    if (!env.integrations.metricsSync) {
      throw new NotImplementedException('metrics-sync não habilitado (fase Escala).');
    }
    if (!t.orgId) throw new BadRequestException('org ausente');
    const pubs = await this.pg.withTenant(t, (c) =>
      c
        .query<{ id: string; platform: string }>(
          `SELECT id, platform FROM openrate.video_publications
            WHERE status = 'published' ORDER BY created_at DESC LIMIT 200`,
        )
        .then((r) => r.rows),
    );
    const window = this.hourWindow();
    for (const p of pubs) {
      await this.queues.enqueueMetricsSync(
        { orgId: t.orgId, correlationId: t.correlationId, publicationId: p.id, platform: p.platform },
        window,
      );
    }
    return { enqueued: pubs.length };
  }

  // Dispara a sincronização com o ERP Olist/Tiny (catálogo ou vendas de balcão).
  @Post('olist/sync')
  @Roles('owner')
  async olistSync(
    @CurrentTenant() t: TenantContext,
    @Body() body: { kind?: 'products' | 'sales'; since?: string },
  ): Promise<{ enqueued: boolean; kind: 'products' | 'sales' }> {
    if (!env.integrations.olist) {
      throw new NotImplementedException('Conector Olist não habilitado (fase Escala).');
    }
    if (!t.orgId) throw new BadRequestException('org ausente');
    const kind = body.kind === 'sales' ? 'sales' : 'products';
    await this.queues.enqueueOlistSync(
      { orgId: t.orgId, correlationId: t.correlationId, kind, since: body.since ?? null },
      this.hourWindow(),
    );
    return { enqueued: true, kind };
  }
}

@Module({ controllers: [IntegrationsController] })
export class IntegrationsModule {}
