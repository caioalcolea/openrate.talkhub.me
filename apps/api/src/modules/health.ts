import { Controller, Get, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PgService } from '../common/pg.service';
import { Public } from '../common/tenant';
import { env } from '../common/env';

@Controller('health')
class HealthController {
  constructor(private readonly pg: PgService) {}

  @Public()
  @Get()
  async health(): Promise<{ status: string; db: boolean; redis: boolean }> {
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

    return { status: db && redisOk ? 'ok' : 'degraded', db, redis: redisOk };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
