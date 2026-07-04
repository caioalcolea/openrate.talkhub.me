import pino from 'pino';

// redact protege contra vazar segredos se um objeto de erro do axios (que
// carrega config.headers.apikey/authorization) for logado por engano.
export const logger = pino({
  name: 'openrate-worker',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'err.config.headers.apikey',
      'err.config.headers.Authorization',
      'err.config.headers.authorization',
      'err.request',
      '*.apikey',
      '*.authorization',
    ],
    censor: '[redacted]',
  },
});
