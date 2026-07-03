import express from 'express';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import pino from 'pino';
import { ALL_QUEUES } from '@openrate/shared';

const log = pino({ name: 'openrate-bullboard' });
const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Opções de conexão a partir da URL — evita depender da instância do ioredis
// (bullmq empacota sua própria versão; passar options desacopla os tipos).
function redisConnection() {
  const u = new URL(REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

const queues = ALL_QUEUES.map((name) => new Queue(name, { connection: redisConnection() }));

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

createBullBoard({
  queues: queues.map((q) => new BullMQAdapter(q)),
  serverAdapter,
});

const app = express();
// A autenticação é feita pelo middleware basicauth do Traefik (deploy/openrate.yaml).
app.use('/', serverAdapter.getRouter());

const server = app.listen(PORT, () => {
  log.info({ port: PORT, queues: ALL_QUEUES }, 'Bull Board no ar');
});

function shutdown(signal: string) {
  log.info({ signal }, 'encerrando');
  server.close(() => {
    Promise.all(queues.map((q) => q.close())).finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
