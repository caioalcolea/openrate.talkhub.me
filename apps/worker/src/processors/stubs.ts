import type { Job } from 'bullmq';
import type { MetricsSyncJob, PayoutPixJob } from '@openrate/shared';
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
