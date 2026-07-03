import type { Job } from 'bullmq';
import type {
  MetricsSyncJob,
  CommissionSettlementJob,
  PayoutPixJob,
} from '@openrate/shared';
import { logger } from '../lib/logger';

// Processadores das fases posteriores (Sprints 4-6+). Estrutura pronta e
// registrada; a lógica de negócio entra quando a fase for puxada.

export async function processMetricsSync(job: Job<MetricsSyncJob>): Promise<void> {
  // Fase Escala: APIs oficiais quando houver; Browserless como fallback de
  // scraping best-effort. Métricas nunca alimentam o financeiro.
  logger.info({ publicationId: job.data.publicationId }, 'metrics-sync (stub) — implementar na fase Escala');
}

export async function processCommissionSettlement(
  job: Job<CommissionSettlementJob>,
): Promise<void> {
  // Fase Dinheiro: consolida commission_entries do período em payouts
  // (idempotente por (org, period)). Ver docs/02 §4.3.
  logger.info({ period: job.data.period }, 'commission-settlement (stub) — implementar na Sprint 5');
}

export async function processPayoutPix(job: Job<PayoutPixJob>): Promise<void> {
  // Fase Escala: Asaas transfer com idempotency key = payoutId. SEM retry
  // automático (financeiro) — reprocesso manual via Bull Board.
  logger.info({ payoutId: job.data.payoutId }, 'payout-pix (stub) — implementar na fase Escala');
}
