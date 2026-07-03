import { Queue } from 'bullmq';
import { QUEUES, jobIds, type NotificationJob } from '@openrate/shared';
import { redisConnection } from './env';

// O worker também PRODUZ jobs de notificação (ex.: "vídeo pronto" após o
// processamento). Fila dedicada reaproveitando a mesma conexão Redis.
export const notificationsQueue = new Queue(QUEUES.notifications, {
  connection: redisConnection(),
});

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationsQueue.add('notify', job, {
    jobId: jobIds.notification(job.template, job.notificationId),
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  });
}
