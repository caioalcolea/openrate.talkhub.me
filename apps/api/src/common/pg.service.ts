import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { claimsForSetConfig, type TenantContext } from '@openrate/shared';
import { env } from './env';

@Injectable()
export class PgService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: env.databaseUrl, max: env.dbPoolMax });

  // Query sem contexto de tenant (rotas públicas: health). SEMPRE parametrizada.
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as any[]);
  }

  // Toda operação tenant-scoped roda aqui: abre transação, injeta os claims
  // validados no GUC (is_local=true, não vaza no pool) para o RLS valer nesta
  // conexão direta, e garante COMMIT/ROLLBACK. Só queries parametrizadas — o
  // RLS não contém SQLi (ver docs/01 §2.13); a app íntegra é a premissa.
  async withTenant<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        claimsForSetConfig(ctx),
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

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
