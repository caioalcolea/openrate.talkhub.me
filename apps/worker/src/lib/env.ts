export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://openrate_app:dev_openrate@localhost:5432/openrate',
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 5),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  s3Bucket: process.env.S3_BUCKET ?? 'openrate-media',
  s3Region: process.env.S3_REGION ?? 'eu-south',
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  s3AccessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  s3SecretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModelPrimary: process.env.AI_MODEL_PRIMARY ?? 'claude-sonnet-5',
  aiModelFallback: process.env.AI_MODEL_FALLBACK ?? 'claude-haiku-4-5-20251001',

  asaasApiKey: process.env.ASAAS_API_KEY ?? '',
  asaasBaseUrl: process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3',

  evolutionApiUrl: process.env.EVOLUTION_API_URL ?? '',
  evolutionApiKey: process.env.EVOLUTION_API_KEY ?? '',
  evolutionInstance: process.env.EVOLUTION_INSTANCE ?? 'openrate',

  browserlessUrl: process.env.BROWSERLESS_URL ?? '',
  whisperModel: process.env.WHISPER_MODEL ?? 'small',
};

// Fail-closed: em produção, recusa subir com segredos ausentes/de dev — senão o
// worker conectaria (ou tentaria) em recursos errados silenciosamente.
export function assertProductionEnv(): void {
  if (env.nodeEnv !== 'production') return;
  const bad: string[] = [];
  if (env.databaseUrl.includes('dev_openrate') || env.databaseUrl.includes('@localhost')) bad.push('DATABASE_URL');
  if (env.redisUrl.includes('@localhost') || env.redisUrl === 'redis://localhost:6379') bad.push('REDIS_URL');
  if (!env.s3SecretKey || env.s3SecretKey === 'minioadmin') bad.push('S3_SECRET_KEY');
  if (!env.s3AccessKey || env.s3AccessKey === 'minioadmin') bad.push('S3_ACCESS_KEY');
  if (!env.anthropicApiKey) bad.push('ANTHROPIC_API_KEY');
  if (bad.length) {
    throw new Error(`Worker: env de produção inválida ou com valores de dev: ${bad.join(', ')}.`);
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
