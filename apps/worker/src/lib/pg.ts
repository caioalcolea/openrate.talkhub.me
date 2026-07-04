import { Pool, PoolClient } from 'pg';
import { claimsForSetConfig, type JobTenant, type TenantContext } from '@openrate/shared';
import { env } from './env';

// Pool único do worker. Menor que o da API (o worker é CPU-bound, poucas conexões).
export const pool = new Pool({ connectionString: env.databaseUrl, max: env.databasePoolMax });

// Contexto sintético do tenant do job: role 'owner' dá acesso dentro da própria
// org (o RLS isola por organization_id; a autorização fina é da API, não do job).
function jobToContext(t: JobTenant): TenantContext {
  return {
    userId: t.userId ?? '00000000-0000-0000-0000-000000000000',
    orgId: t.orgId,
    storeId: t.storeId ?? null,
    role: 'owner',
    correlationId: t.correlationId,
  };
}

// Executa fn dentro de uma transação com o claim do tenant injetado (is_local),
// para o RLS valer também nesta conexão direta. SEMPRE queries parametrizadas.
export async function withTenant<T>(
  tenant: JobTenant,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      claimsForSetConfig(jobToContext(tenant)),
    ]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
