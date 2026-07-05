import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { PgService } from '../common/pg.service';
import { Public } from '../common/tenant';
import { env } from '../common/env';

@Controller('health')
class HealthController {
  constructor(private readonly pg: PgService) {}

  @Public()
  @Get()
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; db: boolean; redis: boolean }> {
    const db = await this.pg
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let redisOk = false;
    try {
      await redis.connect();
      redisOk = (await redis.ping()) === 'PONG';
    } catch {
      redisOk = false;
    } finally {
      redis.disconnect();
    }

    // 503 quando degradado → o healthcheck do container (curl -f) falha e o Swarm
    // não roteia tráfego para uma réplica sem banco/redis.
    const ok = db && redisOk;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', db, redis: redisOk };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
