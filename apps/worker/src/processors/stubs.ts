import type { Job } from 'bullmq';
import type { MetricsSyncJob, PayoutPixJob, OlistSyncJob } from '@openrate/shared';
import { logger } from '../lib/logger';

// Processadores da fase Escala. Estrutura pronta e registrada; a lógica de
// negócio entra quando a fase for puxada.

export async function processMetricsSync(job: Job<MetricsSyncJob>): Promise<void> {
  // APIs oficiais quando houver; Browserless como fallback de scraping
  // best-effort. Métricas nunca alimentam o financeiro.
  logger.info({ publicationId: job.data.publicationId }, 'metrics-sync (stub) — fase Escala');
}

export async function processPayoutPix(job: Job<PayoutPixJob>): Promise<void> {
  // Asaas transfer com idempotency key = payoutId. SEM retry automático
  // (financeiro) — reprocesso manual via Bull Board. Na Sprint 5 o payout é
  // registrado manualmente na API; este job automatiza na fase Escala.
  logger.info({ payoutId: job.data.payoutId }, 'payout-pix (stub) — fase Escala');
}

export async function processOlistSync(job: Job<OlistSyncJob>): Promise<void> {
  // Conector Olist/Tiny (ERP): kind='products' importa/atualiza catálogo;
  // kind='sales' traz vendas de balcão (source='erp'). Upsert idempotente por
  // external_id. A comissão NUNCA deriva daqui (só de affiliate_sales).
  logger.info({ orgId: job.data.orgId, kind: job.data.kind }, 'olist-sync (stub) — fase Escala');
}
