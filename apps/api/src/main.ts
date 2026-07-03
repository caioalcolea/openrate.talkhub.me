import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { env } from './common/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  // correlation id fim a fim (propagado para os jobs).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.enableCors({ origin: true, credentials: true });
  // Prefixo /v1 em tudo, menos o /health (contrato do healthcheck do container).
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  await app.listen(env.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`OpenRate API no ar em :${env.port}`);
}

void bootstrap();
