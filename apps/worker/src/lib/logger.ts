import pino from 'pino';

export const logger = pino({
  name: 'openrate-worker',
  level: process.env.LOG_LEVEL ?? 'info',
});
