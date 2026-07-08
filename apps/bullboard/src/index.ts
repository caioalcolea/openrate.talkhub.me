import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import pino from 'pino';
import { ALL_QUEUES } from '@openrate/shared';

const log = pino({ name: 'openrate-bullboard' });
const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const BB_USER = process.env.BULLBOARD_USER ?? '';
const BB_PASS = process.env.BULLBOARD_PASSWORD ?? '';

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Basic auth de APLICAÇÃO (defesa em profundidade além do basicauth do Traefik):
// sem isto, qualquer container da overlay compartilhada alcançaria o Bull Board
// (leste-oeste) sem passar pela borda. Fail-closed em produção.
function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!BB_USER || !BB_PASS) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).send('Bull Board indisponível: defina BULLBOARD_USER/BULLBOARD_PASSWORD.');
      return;
    }
    return next(); // dev: sem credenciais, libera
  }
  const h = req.headers.authorization ?? '';
  if (h.startsWith('Basic ')) {
    const [u, p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (eq(u ?? '', BB_USER) && eq(p ?? '', BB_PASS)) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="OpenRate Bull Board"');
  res.status(401).send('Autenticação necessária.');
}

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
// 1ª camada: basicauth do Traefik na borda (deploy/openrate.yaml). 2ª camada
// (esta): basic auth de aplicação, protege contra acesso leste-oeste na overlay.
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.use(basicAuth);
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
