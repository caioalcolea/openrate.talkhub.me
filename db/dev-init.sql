-- Inicialização do Postgres de DESENVOLVIMENTO (docker-compose.dev.yml).
-- Roda uma vez como superuser na criação do container. Reproduz localmente o
-- que o runbook faz em produção (roles owner/app + schema + pgcrypto), para a
-- migration 0001_init.sql aplicar igual ao ambiente real.
-- NÃO é usado em produção.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- schema auth só para paridade com o Supabase (vazio em dev)
CREATE SCHEMA IF NOT EXISTS auth;

-- role de migração (dona do schema)
CREATE ROLE openrate_owner LOGIN PASSWORD 'dev_openrate'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- role de runtime (não-dona, sujeita a RLS) — senha bate com DATABASE_URL do .env.dev
CREATE ROLE openrate_app LOGIN PASSWORD 'dev_openrate'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE SCHEMA openrate AUTHORIZATION openrate_owner;

GRANT USAGE ON SCHEMA extensions TO openrate_owner, openrate_app;
ALTER ROLE openrate_owner SET search_path = openrate, extensions;
ALTER ROLE openrate_app   SET search_path = openrate, extensions;
