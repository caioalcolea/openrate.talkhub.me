import { Worker, type Job } from 'bullmq';
import { QUEUES, DEFAULT_QUEUE_CONCURRENCY, type QueueName } from '@openrate/shared';
import { redisConnection } from './lib/env';
import { logger } from './lib/logger';
import { pool } from './lib/pg';
import { processAiScript } from './processors/ai-script-generation';
import { processVideo } from './processors/video-processing';
import { processNotification } from './processors/notifications';
import { processCommissionSettlement } from './processors/settlement';
import { processMetricsSync, processPayoutPix } from './processors/stubs';

// Concorrência efetiva: env CONCURRENCY_* sobrepõe os defaults do shared.
function concurrency(queue: QueueName): number {
  const map: Record<QueueName, string | undefined> = {
    'video-processing': process.env.CONCURRENCY_VIDEO_PROCESSING,
    'ai-script-generation': process.env.CONCURRENCY_AI_SCRIPT,
    'metrics-sync': process.env.CONCURRENCY_METRICS_SYNC,
    notifications: process.env.CONCURRENCY_NOTIFICATIONS,
    'commission-settlement': undefined,
    'payout-pix': undefined,
  };
  const v = map[queue];
  return v ? Number(v) : DEFAULT_QUEUE_CONCURRENCY[queue];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: Record<QueueName, (job: Job<any>) => Promise<void>> = {
  'video-processing': processVideo,
  'ai-script-generation': processAiScript,
  'metrics-sync': processMetricsSync,
  'commission-settlement': processCommissionSettlement,
  'payout-pix': processPayoutPix,
  notifications: processNotification,
};

const workers: Worker[] = [];

for (const name of Object.values(QUEUES)) {
  const w = new Worker(name, handlers[name], {
    connection: redisConnection(),
    concurrency: concurrency(name),
  });
  w.on('failed', (job, err) =>
    logger.error({ queue: name, jobId: job?.id, err: err.message }, 'job falhou'),
  );
  w.on('completed', (job) => logger.info({ queue: name, jobId: job.id }, 'job concluído'));
  workers.push(w);
  logger.info({ queue: name, concurrency: concurrency(name) }, 'worker registrado');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'encerrando workers');
  await Promise.all(workers.map((w) => w.close()));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info('OpenRate worker no ar');
