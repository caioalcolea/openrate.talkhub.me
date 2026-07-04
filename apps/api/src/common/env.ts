export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://openrate_app:dev_openrate@localhost:5432/openrate',
  dbPoolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  supabaseUrl: process.env.SUPABASE_URL ?? 'http://localhost:8000',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  jwtSecret: process.env.SUPABASE_JWT_SECRET ?? 'dev-super-secret-hs256-change-me',

  s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  s3Bucket: process.env.S3_BUCKET ?? 'openrate-media',
  s3Region: process.env.S3_REGION ?? 'eu-south',
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  s3AccessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
  s3SecretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',

  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? '',
  docusealWebhookToken: process.env.DOCUSEAL_WEBHOOK_TOKEN ?? '',

  // URL pública da própria API (base dos links de afiliado /r/:code).
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'https://openrate-api.talkhub.me',
};

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
