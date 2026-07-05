export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://openrate_app:dev_openrate@localhost:5432/openrate',
  dbPoolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Segredo HS256 com que a API assina e valida o próprio JWT (auth própria).
  jwtSecret: process.env.JWT_SECRET ?? 'dev-super-secret-hs256-change-me',

  s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  s3Bucket: process.env.S3_BUCKET ?? 'openrate-media',
  s3Region: process.env.S3_REGION ?? 'eu-south',
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  s3AccessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  s3SecretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',

  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? '',
  docusealWebhookToken: process.env.DOCUSEAL_WEBHOOK_TOKEN ?? '',

  // Segredo que libera POST /v1/auth/bootstrap (criação do 1º super_admin).
  // Sem ele o endpoint fica desabilitado (fail-closed).
  bootstrapToken: process.env.BOOTSTRAP_TOKEN ?? '',

  // Integrações da fase Escala (stubs): habilitadas por FLAG explícita injetada no
  // container da API (os SEGREDOS ficam só no worker — menor privilégio). Enquanto
  // off, os endpoints de disparo respondem 501 em vez de enfileirar jobs inertes.
  integrations: {
    asaas: process.env.ASAAS_ENABLED === 'true',
    olist: process.env.OLIST_ENABLED === 'true',
    metricsSync: process.env.METRICS_SYNC_ENABLED === 'true',
  },

  // URL pública da própria API (base dos links de afiliado /r/:code).
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'https://openrate-api.talkhub.me',

  // Origens permitidas no CORS (o PWA/painel). Em produção NÃO refletimos qualquer
  // origem com credentials — só as conhecidas. WEB_ORIGIN aceita lista por vírgula.
  corsOrigins: (process.env.WEB_ORIGIN ?? 'https://openrate.talkhub.me')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

const DEFAULT_JWT_SECRET = 'dev-super-secret-hs256-change-me';

// Fail-closed: em produção, RECUSA subir com segredos ausentes ou iguais ao
// default de dev — senão qualquer um forjaria um JWT (bypass total de auth).
export function assertProductionEnv(): void {
  if (env.nodeEnv !== 'production') return;
  const bad: string[] = [];
  // JWT_SECRET é ESSENCIAL: a API assina e valida o próprio JWT com ele.
  // Sem um segredo real (ou curto), qualquer um forjaria um token (bypass de auth).
  if (!env.jwtSecret || env.jwtSecret === DEFAULT_JWT_SECRET || env.jwtSecret.length < 32) {
    bad.push('JWT_SECRET (defina >= 32 chars aleatórios)');
  }
  if (!env.s3SecretKey || env.s3SecretKey === 'minioadmin') bad.push('S3_SECRET_KEY');
  if (!env.s3AccessKey || env.s3AccessKey === 'minioadmin') bad.push('S3_ACCESS_KEY');
  if (env.databaseUrl.includes('dev_openrate') || env.databaseUrl.includes('@localhost')) bad.push('DATABASE_URL');
  if (env.redisUrl.includes('@localhost') || env.redisUrl === 'redis://localhost:6379') bad.push('REDIS_URL');
  // BOOTSTRAP_TOKEN protege a criação do 1º super_admin — obrigatório em produção.
  if (!env.bootstrapToken || env.bootstrapToken.length < 16) bad.push('BOOTSTRAP_TOKEN (defina >= 16 chars)');
  if (bad.length) {
    throw new Error(
      `Env de produção inválida ou com valores de dev: ${bad.join(', ')}. ` +
        'Defina segredos reais antes de subir a API.',
    );
  }
}

export function redisConnection() {
  const u = new URL(env.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}
