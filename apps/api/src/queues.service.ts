import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  QUEUES,
  QUEUE_JOB_OPTIONS,
  jobIds,
  type AiScriptGenerationJob,
  type VideoProcessingJob,
  type NotificationJob,
  type CommissionSettlementJob,
  type MetricsSyncJob,
  type PayoutPixJob,
  type OlistSyncJob,
} from '@openrate/shared';
import { redisConnection } from './common/env';

// Produtor BullMQ da API. Um Queue por fila; a API só ENFILEIRA (o worker
// consome). jobId determinístico descarta duplicatas.
@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  private get(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: redisConnection() });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueueAiScript(job: AiScriptGenerationJob, regen = 0): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.aiScriptGeneration];
    await this.get(QUEUES.aiScriptGeneration).add('generate', job, {
      jobId: jobIds.aiScript(job.productId, job.videoTypeId, regen),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    });
  }

  async enqueueVideoProcessing(job: VideoProcessingJob): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.videoProcessing];
    await this.get(QUEUES.videoProcessing).add('process', job, {
      jobId: jobIds.videoProcessing(job.videoId),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    });
  }

  async enqueueCommissionSettlement(job: CommissionSettlementJob): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.commissionSettlement];
    await this.get(QUEUES.commissionSettlement).add('settle', job, {
      jobId: jobIds.commissionSettlement(job.orgId, job.period),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    });
  }

  async enqueueNotification(job: NotificationJob): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.notifications];
    await this.get(QUEUES.notifications).add('notify', job, {
      jobId: jobIds.notification(job.template, job.notificationId),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    });
  }

  // --- Seams da fase Escala (processadores stub no worker até a fase ser puxada) ---

  async enqueueMetricsSync(job: MetricsSyncJob, isoWindow: string): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.metricsSync];
    await this.get(QUEUES.metricsSync).add('sync', job, {
      jobId: jobIds.metricsSync(job.publicationId, isoWindow),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    });
  }

  // payout-pix: SEM retry (financeiro) — reprocesso manual via Bull Board.
  async enqueuePayoutPix(job: PayoutPixJob): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.payoutPix];
    await this.get(QUEUES.payoutPix).add('pay', job, {
      jobId: jobIds.payoutPix(job.payoutId),
      attempts: opts.attempts,
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    });
  }

  async enqueueOlistSync(job: OlistSyncJob, isoWindow: string): Promise<void> {
    const opts = QUEUE_JOB_OPTIONS[QUEUES.olistSync];
    await this.get(QUEUES.olistSync).add('sync', job, {
      jobId: jobIds.olistSync(job.orgId, job.kind, isoWindow),
      attempts: opts.attempts,
      backoff: opts.backoffMs ? { type: 'exponential', delay: opts.backoffMs } : undefined,
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
