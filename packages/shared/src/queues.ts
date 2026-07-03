// Nomes das 6 filas BullMQ e construtores de jobId determinístico.
// Fonte única para produtores (API), consumidores (worker) e Bull Board.

export const QUEUES = {
  videoProcessing: 'video-processing',
  aiScriptGeneration: 'ai-script-generation',
  metricsSync: 'metrics-sync',
  commissionSettlement: 'commission-settlement',
  payoutPix: 'payout-pix',
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

// jobId determinístico → o BullMQ descarta duplicatas enquanto o job existir.
// A idempotência do EFEITO (UNIQUE/UPSERT/idempotency key) é garantida no banco/
// serviço externo — nunca depende só do jobId (jobs concluídos são removidos).
export const jobIds = {
  videoProcessing: (videoId: string) => `video-processing:${videoId}`,
  aiScript: (productId: string, videoTypeId: string, regen = 0) =>
    regen > 0
      ? `ai-script:${productId}:${videoTypeId}:regen-${regen}`
      : `ai-script:${productId}:${videoTypeId}`,
  metricsSync: (publicationId: string, isoWindow: string) =>
    `metrics-sync:${publicationId}:${isoWindow}`,
  commissionSettlement: (orgId: string, period: string) =>
    `commission-settlement:${orgId}:${period}`,
  payoutPix: (payoutId: string) => `payout-pix:${payoutId}`,
  notification: (event: string, entityId: string) => `notifications:${event}:${entityId}`,
};

// Contexto de tenant que viaja em TODO payload de job (o worker refaz o
// set_config com esses dados antes de tocar o banco).
export interface JobTenant {
  orgId: string;
  storeId?: string | null;
  userId?: string | null;
  correlationId: string;
}

// --- Payloads tipados por fila ---

export interface VideoProcessingJob extends JobTenant {
  videoId: string;
  rawKey: string; // raw/{org}/{store}/{video_id}/source.ext no bucket openrate-media
}

export interface AiScriptGenerationJob extends JobTenant {
  productId: string;
  videoTypeId: string;
  batchId: string;
  count: number; // nº de ideias (default 40)
}

export interface NotificationJob extends JobTenant {
  notificationId: string;
  channel: 'whatsapp' | 'push' | 'email' | 'in_app';
  template: string; // goal_reached | video_approved | video_rejected | commission_credited | payout_paid | image_release
  to: string; // telefone E.164 (whatsapp) ou user_id (in_app)
  vars: Record<string, string | number>;
}

export interface MetricsSyncJob extends JobTenant {
  publicationId: string;
  platform: string;
}

export interface CommissionSettlementJob extends JobTenant {
  period: string; // ex.: 2026-07 ou 2026-W27
}

export interface PayoutPixJob extends JobTenant {
  payoutId: string;
}

// Política de retries/backoff por fila (BullMQ defaultJobOptions).
// payout-pix NÃO tem retry automático (dinheiro): reprocesso manual no Bull Board.
export const QUEUE_JOB_OPTIONS: Record<QueueName, { attempts: number; backoffMs?: number }> = {
  'video-processing': { attempts: 3, backoffMs: 30_000 },
  'ai-script-generation': { attempts: 4, backoffMs: 15_000 },
  'metrics-sync': { attempts: 3, backoffMs: 60_000 },
  'commission-settlement': { attempts: 2, backoffMs: 300_000 },
  'payout-pix': { attempts: 1 },
  notifications: { attempts: 5, backoffMs: 10_000 },
};

// Concorrência PADRÃO por fila. video-processing=1 no go-live (nó único).
// shared é isomórfico (usado também pelo web/browser), então NÃO lê env aqui —
// o worker sobrepõe estes defaults com as CONCURRENCY_* do ambiente.
export const DEFAULT_QUEUE_CONCURRENCY: Record<QueueName, number> = {
  'video-processing': 1,
  'ai-script-generation': 2,
  'metrics-sync': 2,
  'commission-settlement': 1,
  'payout-pix': 1,
  notifications: 5,
};
