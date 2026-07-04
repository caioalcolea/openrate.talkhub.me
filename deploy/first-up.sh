#!/usr/bin/env bash
# ============================================================================
# OpenRate — PRIMEIRO DEPLOY (idempotente). Rode no nó MANAGER do Swarm.
#
#   cp deploy/.env.example deploy/.env   # e preencha os segredos
#   bash deploy/first-up.sh              # a partir da RAIZ do repositório
#
# O que faz (só operações ADITIVAS — nada destrutivo na produção existente):
#   1. Pré-checagens (docker, swarm manager, .env)
#   2. DNS dos 3 hosts (aviso)
#   3. Volume openrate_redis_data
#   4. Postgres do Supabase: roles openrate_owner/openrate_app + schema +
#      migrations 0001 (como owner) / 0002 / 0003 (como postgres)
#   5. MinIO: bucket openrate-media + lifecycle (raw/ 30d) + usuário + policy
#   6. Build das 4 imagens talkhub/openrate-*
#   7. docker stack deploy openrate
#   8. Smoke tests (/health, painel, Bull Board)
# Reexecutável: pula o que já existe.
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
ENV_FILE="deploy/.env"
STACK="openrate"
DOMAIN="talkhub.me"

c_g="\033[1;32m"; c_y="\033[1;33m"; c_r="\033[1;31m"; c_0="\033[0m"
log(){ printf "${c_g}▶ %s${c_0}\n" "$*"; }
warn(){ printf "${c_y}⚠ %s${c_0}\n" "$*"; }
die(){ printf "${c_r}✖ %s${c_0}\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. pré-checagens
log "1/8 Pré-checagens"
command -v docker >/dev/null || die "docker não encontrado."
docker info >/dev/null 2>&1 || die "docker daemon inacessível."
docker node ls >/dev/null 2>&1 || die "este nó NÃO é manager do Swarm."
[ -f "$ENV_FILE" ] || die "crie $ENV_FILE a partir de deploy/.env.example e preencha os segredos."
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${OPENRATE_DB_PASSWORD:?defina em .env}"
: "${OPENRATE_DB_OWNER_PASSWORD:?defina em .env}"
: "${OPENRATE_REDIS_PASSWORD:?defina em .env}"
: "${S3_ACCESS_KEY:?}"; : "${S3_SECRET_KEY:?}"
: "${MINIO_ROOT_USER:?defina em .env}"; : "${MINIO_ROOT_PASSWORD:?defina em .env}"
: "${SUPABASE_JWT_SECRET:?}"; : "${BULLBOARD_BASICAUTH:?}"
docker network inspect talkhub >/dev/null 2>&1 || die "rede overlay 'talkhub' não existe."

find_ctr(){ docker ps -q -f "name=^$1\\." | head -1; }
# Conecta como superuser postgres: -u postgres cobre peer/trust via socket;
# PGPASSWORD cobre md5/scram. Um dos dois funciona em qualquer config do supabase_db.
psql_su(){ docker exec -u postgres -e PGPASSWORD="${SUPABASE_DB_POSTGRES_PASSWORD:-}" -i "$DBCTR" psql -U postgres -d postgres "$@"; }

# ---------------------------------------------------------------- 2. DNS
log "2/8 DNS dos hosts"
for h in openrate openrate-api openrate-queues; do
  ip="$(getent hosts "$h.$DOMAIN" 2>/dev/null | awk '{print $1}' | tail -1 || true)"
  if [ -n "$ip" ]; then log "  $h.$DOMAIN → $ip"; else warn "  $h.$DOMAIN ainda NÃO resolve (o Let's Encrypt do Traefik precisa)."; fi
done

# ---------------------------------------------------------------- 3. volume
log "3/8 Volume do Redis dedicado"
if docker volume inspect openrate_redis_data >/dev/null 2>&1; then
  log "  openrate_redis_data já existe"
else
  docker volume create openrate_redis_data >/dev/null && log "  criado openrate_redis_data"
fi

# ---------------------------------------------------------------- 4. Postgres
log "4/8 Postgres (roles + schema + migrations)"
DBCTR="$(find_ctr supabase_db)"; [ -n "$DBCTR" ] || die "container supabase_db não está rodando."
psql_su -tAc "SELECT 1" >/dev/null 2>&1 || die "não consegui conectar no supabase_db como postgres."

role_exists(){ [ "$(psql_su -tAc "SELECT 1 FROM pg_roles WHERE rolname='$1'")" = "1" ]; }
# IMPORTANTE: a substituição de variáveis do psql (:'pw') SÓ acontece quando o SQL
# vem do stdin/-f — NÃO com -c (o -c manda a string crua ao servidor). Por isso
# alimentamos via heredoc, e não via -c.
if role_exists openrate_owner; then log "  role openrate_owner ok"; else
  psql_su -v ON_ERROR_STOP=1 -v pw="$OPENRATE_DB_OWNER_PASSWORD" >/dev/null <<'SQL'
CREATE ROLE openrate_owner LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
  log "  role openrate_owner criada"
fi
if role_exists openrate_app; then log "  role openrate_app ok"; else
  psql_su -v ON_ERROR_STOP=1 -v pw="$OPENRATE_DB_PASSWORD" >/dev/null <<'SQL'
CREATE ROLE openrate_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
SQL
  log "  role openrate_app criada"
fi
# schema (dono = owner) + search_path + grants (idempotente)
# NOTA: no supabase_db o "postgres" NÃO é superuser (é CREATEROLE). Para criar o
# schema com AUTHORIZATION openrate_owner — e depois SET ROLE openrate_owner — ele
# precisa ser MEMBRO da role. Com CREATEROLE ele pode conceder a si mesmo.
psql_su -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT CONNECT ON DATABASE postgres TO openrate_owner, openrate_app;
GRANT openrate_owner TO CURRENT_USER;
CREATE SCHEMA IF NOT EXISTS openrate AUTHORIZATION openrate_owner;
ALTER ROLE openrate_owner SET search_path = openrate, extensions;
ALTER ROLE openrate_app   SET search_path = openrate, extensions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='extensions') THEN
    BEGIN
      -- não-fatal: se "postgres" não for dono do schema extensions o Supabase
      -- em geral já concede USAGE às roles; não abortamos o deploy por isso.
      EXECUTE 'GRANT USAGE ON SCHEMA extensions TO openrate_owner, openrate_app';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'sem privilegio p/ GRANT USAGE em extensions; seguindo (Supabase costuma conceder por padrao).';
    END;
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM openrate_app;
SQL

if [ -z "$(psql_su -tAc "SET ROLE openrate_owner; SELECT to_regclass('openrate.organizations')" | tail -1)" ]; then
  log "  aplicando 0001_init.sql (como openrate_owner)"
  { echo "SET ROLE openrate_owner;"; sed '/^-- migrate:down/,$d' db/migrations/0001_init.sql; echo "RESET ROLE;"; } \
    | psql_su -v ON_ERROR_STOP=1 --single-transaction -f - >/dev/null
else
  log "  schema openrate já migrado (0001) — pulando"
fi
# 0002/0003 rodam como openrate_owner (dono do schema/tabelas). Sem superuser no
# supabase_db, é o owner quem contorna o RLS de forma controlada: a 0002 cria uma
# policy só-para-o-owner na affiliate_links (a função SECURITY DEFINER roda como
# o owner) e a 0003 suspende o FORCE só durante o seed org-null e o restaura.
log "  aplicando 0002 (resolver de link) e 0003 (seed video_types) como openrate_owner"
{ echo "SET ROLE openrate_owner;"; sed '/^-- migrate:down/,$d' db/migrations/0002_affiliate_link_resolver.sql; echo "RESET ROLE;"; } \
  | psql_su -v ON_ERROR_STOP=1 --single-transaction -f - >/dev/null
{ echo "SET ROLE openrate_owner;"; sed '/^-- migrate:down/,$d' db/migrations/0003_seed_video_types.sql; echo "RESET ROLE;"; } \
  | psql_su -v ON_ERROR_STOP=1 --single-transaction -f - >/dev/null
# A contagem de video_types roda sob RLS (postgres não é dono nem tem BYPASSRLS);
# usamos um claim super_admin efêmero p/ a policy super_admin_all liberar a leitura,
# senão o log mostraria 0 mesmo com o seed aplicado.
_vt="$(psql_su -tAc "SELECT set_config('request.jwt.claims','{\"app_metadata\":{\"role\":\"super_admin\"}}',false); SELECT count(*) FROM openrate.video_types WHERE organization_id IS NULL" | tail -1 | tr -d '[:space:]')"
log "  banco: $(psql_su -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='openrate' AND table_type='BASE TABLE'") tabelas, ${_vt:-?} tipos de vídeo"

# ---------------------------------------------------------------- 5. MinIO
log "5/8 MinIO (bucket + lifecycle + usuário + policy)"
docker run --rm --network talkhub \
  -e RUSER="$MINIO_ROOT_USER" -e RPASS="$MINIO_ROOT_PASSWORD" \
  -e ACCESS="$S3_ACCESS_KEY" -e SECRET="$S3_SECRET_KEY" \
  --entrypoint /bin/sh quay.io/minio/mc -c '
    set -e
    mc alias set t http://minio_minio:9000 "$RUSER" "$RPASS"
    mc mb --ignore-existing t/openrate-media
    mc anonymous set none t/openrate-media
    ( mc ilm rule add t/openrate-media --expire-days 30 --prefix "raw/" \
      || mc ilm add t/openrate-media --expiry-days 30 --prefix "raw/" ) 2>/dev/null || true
    mc admin user add t "$ACCESS" "$SECRET" 2>/dev/null || true
    cat > /tmp/p.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket","s3:ListBucketMultipartUploads"],"Resource":["arn:aws:s3:::openrate-media"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListMultipartUploadParts","s3:AbortMultipartUpload"],"Resource":["arn:aws:s3:::openrate-media/*"]}]}
JSON
    mc admin policy create t openrate-media-rw /tmp/p.json 2>/dev/null || true
    mc admin policy attach t openrate-media-rw --user "$ACCESS" 2>/dev/null || true
    echo "  bucket openrate-media pronto"
  '

# ---------------------------------------------------------------- 6. build
log "6/8 Build das imagens (contexto = raiz do monorepo)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo latest)"
docker build -t talkhub/openrate-api:latest       -t "talkhub/openrate-api:$SHA"       -f apps/api/Dockerfile .
docker build -t talkhub/openrate-worker:latest    -t "talkhub/openrate-worker:$SHA"    -f apps/worker/Dockerfile .
docker build -t talkhub/openrate-web:latest       -t "talkhub/openrate-web:$SHA"       -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="https://openrate-api.$DOMAIN" .
docker build -t talkhub/openrate-bullboard:latest -t "talkhub/openrate-bullboard:$SHA" -f apps/bullboard/Dockerfile .
log "  imagens buildadas (tags latest + $SHA)"

# ---------------------------------------------------------------- 7. deploy
log "7/8 Deploy da stack $STACK"
docker stack deploy --detach=true -c deploy/openrate.yaml "$STACK"
log "  stack $STACK enviada"

# ---------------------------------------------------------------- 8. smoke
log "8/8 Aguardando serviços ficarem 1/1..."
for _ in $(seq 1 40); do
  up="$(docker service ls --filter "name=${STACK}_" --format '{{.Replicas}}' | grep -c '^1/1' || true)"
  total="$(docker service ls --filter "name=${STACK}_" --format '{{.Name}}' | wc -l | tr -d ' ')"
  printf "\r  %s/%s serviços prontos" "$up" "$total"
  [ "$up" = "5" ] && break
  sleep 6
done
echo
docker service ls --filter "name=${STACK}_" --format '  {{.Name}}: {{.Replicas}} ({{.Image}})'

log "Smoke tests (podem levar ~1 min até o TLS do Traefik emitir):"
if curl -fsS "https://openrate-api.$DOMAIN/health" >/dev/null 2>&1; then
  log "  API /health OK: $(curl -fsS "https://openrate-api.$DOMAIN/health")"
else
  warn "  /health ainda não respondeu via Traefik (confira DNS + certresolver do Traefik)."
fi
code="$(curl -s -o /dev/null -w '%{http_code}' "https://openrate-queues.$DOMAIN" || true)"
[ "$code" = "401" ] && log "  Bull Board protegido (401 sem credencial) ✓" || warn "  Bull Board retornou HTTP $code (esperado 401)."

log "Concluído. Se algo ficou pendente, veja: docker service ps ${STACK}_openrate_api --no-trunc"
