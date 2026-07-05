import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Pool, type PoolClient } from 'pg';

// Infra dos testes de integração: sobe o schema real (migrations 0001→N) num
// Postgres descartável (DATABASE_URL), cria as roles openrate_owner/openrate_app
// e aplica as migrations como o owner — espelhando produção. Sem DATABASE_URL os
// testes se auto-pulam (hasTestDb()=false), então `pnpm test` local não quebra.

export interface TestDb {
  admin: Pool; // superusuário (bypassa RLS) — para semear dados
  app: Pool; // openrate_app (NOSUPERUSER NOBYPASSRLS) — exercita o RLS
}

export function hasTestDb(): boolean {
  return !!process.env.DATABASE_URL;
}

function findMigrationsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 7; i++) {
    const candidate = join(dir, 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`db/migrations não encontrado a partir de ${process.cwd()}`);
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Constrói uma connection URL trocando usuário/senha, mantendo host/porta/db.
function urlAs(base: string, user: string, password: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = password;
  return u.toString();
}

export async function setupTestDb(): Promise<TestDb> {
  const url = process.env.DATABASE_URL as string;
  const admin = new Pool({ connectionString: url });
  const dbName = new URL(url).pathname.slice(1);

  // 1) extensão + roles + schema limpo (como superusuário)
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrate_owner') THEN
      CREATE ROLE openrate_owner LOGIN PASSWORD 'ownerpw' CREATEROLE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrate_app') THEN
      CREATE ROLE openrate_app LOGIN PASSWORD 'apppw' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await admin.query("ALTER ROLE openrate_owner LOGIN PASSWORD 'ownerpw'");
  await admin.query("ALTER ROLE openrate_app LOGIN PASSWORD 'apppw' NOSUPERUSER NOBYPASSRLS");
  await admin.query(`GRANT ALL ON DATABASE ${ident(dbName)} TO openrate_owner`);
  await admin.query('DROP SCHEMA IF EXISTS openrate CASCADE');

  // 2) aplica as migrations como owner (strip do bloco -- migrate:down)
  const owner = new Pool({ connectionString: urlAs(url, 'openrate_owner', 'ownerpw') });
  try {
    const dir = findMigrationsDir();
    const files = readdirSync(dir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    for (const f of files) {
      const up = readFileSync(join(dir, f), 'utf8').split(/^-- migrate:down/m)[0];
      await owner.query('BEGIN');
      try {
        await owner.query(up);
        await owner.query('COMMIT');
      } catch (e) {
        await owner.query('ROLLBACK').catch(() => undefined);
        throw new Error(`falha aplicando ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await owner.end();
  }

  const app = new Pool({ connectionString: urlAs(url, 'openrate_app', 'apppw') });
  return { admin, app };
}

export async function teardown(db: TestDb | null): Promise<void> {
  if (!db) return;
  await db.app.end();
  await db.admin.end();
}

// Claims no shape real (app_metadata) que claimsForSetConfig produz em produção.
export function claims(userId: string, orgId: string | null, role: string, storeId: string | null = null) {
  return {
    sub: userId,
    app_metadata: { product: 'openrate', org_id: orgId, store_id: storeId, role },
  };
}

// Espelha PgService.withTenant: BEGIN + set_config local dos claims + COMMIT.
export async function withClaims<T>(
  pool: Pool,
  jwtClaims: object,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwtClaims)]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
