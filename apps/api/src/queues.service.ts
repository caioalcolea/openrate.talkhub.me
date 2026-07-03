import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  QUEUES,
  QUEUE_JOB_OPTIONS,
  jobIds,
  type AiScriptGenerationJob,
  type VideoProcessingJob,
  type NotificationJob,
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

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
