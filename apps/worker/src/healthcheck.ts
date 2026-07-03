// Healthcheck do container (deploy/openrate.yaml -> node dist/healthcheck.js):
// PING no Redis e SELECT 1 no Postgres. Sai com código != 0 em falha.
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { env } from './lib/env';

async function main(): Promise<void> {
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  const pg = new Client({ connectionString: env.databaseUrl });
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('redis ping falhou');
    await pg.connect();
    await pg.query('SELECT 1');
  } finally {
    redis.disconnect();
    await pg.end().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('healthcheck falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
