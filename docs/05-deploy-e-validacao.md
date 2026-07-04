# 05 — Deploy e Validação (a partir do Git, na VPS)

> **⚠️ Estado atual:** o deploy é automatizado por [`../deploy/first-up.sh`](../deploy/first-up.sh) e [`../redeploy.sh`](../redeploy.sh). Autenticação **própria da API** (JWT HS256 com `JWT_SECRET`, **sem gotrue**); banco é um **Postgres compartilhado comum** (container `supabase_db`), sem features do Supabase. Referência atual: [`../README.md`](../README.md). Menções a "Supabase/gotrue" abaixo refletem o desenho original.

> Como colocar na VPS **o que existe hoje no repositório** para validar, e o que falta para o stack subir por completo. Complementa [`../deploy/runbook.md`](../deploy/runbook.md) (procedimento detalhado) e [`04-sprints.md`](04-sprints.md) (Sprint 0).

## O que já existe

O repositório contém a **especificação, a arquitetura, a migration do banco, a definição da stack** e agora também o **código das 4 aplicações** (Sprints 0-3):

- `apps/api` (NestJS), `apps/worker` (BullMQ + FFmpeg + faster-whisper), `apps/web` (Next.js — painel + PWA do atendente), `apps/bullboard`, mais `packages/shared` (contratos) e os `Dockerfile`s de cada app.
- Verificado nesta base: `pnpm build` (5/5 pacotes), `pnpm test` verdes, migration aplica como `openrate_owner` não-superuser (27 tabelas/64 policies) e **smoke test E2E da API** (JWT forjado → `/v1/products` retorna dado via RLS; 401 sem token).

| Camada | Estado | Dá para validar hoje? |
|---|---|---|
| Migration do schema `openrate` (`db/migrations/0001_init.sql`) | Pronta e testada | **Sim** — aplica no `supabase_db` real |
| Bucket `openrate-media` no MinIO (+ lifecycle, usuário) | Definido no runbook | **Sim** |
| DNS + volume + rede | Definidos | **Sim** |
| Apps `apps/*` + imagens `talkhub/openrate-*` | Código pronto (Sprints 0-3) | **Sim** — buildar as imagens e subir a stack |

O deploy tem duas etapas: **Etapa A** provisiona/valida a infra (banco, bucket, volume, DNS); **Etapa B** builda as imagens e sobe a stack pelo Portainer.

### Rodar localmente (opcional, antes do servidor)

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d          # Postgres + Redis + MinIO
# aplicar a migration no Postgres de dev:
docker compose -f docker-compose.dev.yml exec -T db \
  sh -c 'psql -U openrate_owner -d openrate -v ON_ERROR_STOP=1 --single-transaction' \
  < <(sed "/^-- migrate:down/,\$d" db/migrations/0001_init.sql)
cp .env.dev.example .env.dev
pnpm dev                                                 # api, worker, web, bullboard
```

---

## Etapa A — Provisionar e validar a infra (executar na VPS)

Todos os comandos rodam no nó manager da VPS (onde já rodam Traefik, Portainer, Supabase, MinIO). Nenhum altera serviço de terceiros — só cria recursos novos do OpenRate.

### A.1 — Trazer o repositório pelo Git

```bash
# escolha um diretório de trabalho para os apps do servidor
sudo mkdir -p /opt/apps && cd /opt/apps

# clonar (troque pela URL do seu remoto; o repo é caioalcolea/openrate.talkhub.me)
git clone https://github.com/caioalcolea/openrate.talkhub.me.git
cd openrate.talkhub.me

# usar a branch de trabalho atual
git checkout claude/openrate-setup-analysis-yoz3ut
git pull origin claude/openrate-setup-analysis-yoz3ut
```

> Atualizações futuras: `git pull` nesse diretório e repetir o passo relevante (aplicar nova migration, rebuildar imagem).

### A.2 — DNS dos 3 hosts

Criar os registros apontando para o IP da VPS (mesmo IP dos demais `*.talkhub.me`) e conferir a propagação — o Traefik precisa resolver para emitir o TLS:

```bash
dig +short openrate.talkhub.me
dig +short openrate-api.talkhub.me
dig +short openrate-queues.talkhub.me
```

### A.3 — Volume do Redis dedicado

```bash
docker volume create openrate_redis_data
docker volume ls | grep openrate   # confirma que só o volume novo foi criado
```

### A.4 — Role, schema e migration no `supabase_db` (a validação principal)

Isto aplica `db/migrations/0001_init.sql` no Postgres **real** de produção e é o teste mais valioso desta etapa. Seguir o `deploy/runbook.md` **passo 3** (reproduzido aqui em resumo):

```bash
# localizar o container do Postgres do Supabase (filtro ANCORADO)
CID=$(docker ps -q -f name='^supabase_db\.')
docker ps --format '{{.Names}}' -f name='^supabase_db\.'   # deve listar exatamente 1

# criar as roles (owner p/ migração + app p/ runtime) e o schema.
# ATENÇÃO: no supabase_db o "postgres" NÃO é superuser (é CREATEROLE). Para criar
# o schema com AUTHORIZATION openrate_owner — e depois SET ROLE openrate_owner —
# ele precisa ser MEMBRO da role: GRANT openrate_owner TO CURRENT_USER.
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE openrate_owner LOGIN PASSWORD 'TROQUE_SENHA_OWNER'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 3;
CREATE ROLE openrate_app LOGIN PASSWORD 'TROQUE_SENHA_APP'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
GRANT openrate_owner TO CURRENT_USER;
CREATE SCHEMA IF NOT EXISTS openrate AUTHORIZATION openrate_owner;
ALTER ROLE openrate_owner SET search_path = openrate;
ALTER ROLE openrate_app   SET search_path = openrate;
REVOKE CREATE ON SCHEMA public FROM openrate_app;
SQL

# 0001/0002/0003 (todas como openrate_owner via SET ROLE) — corta o bloco
# -- migrate:down; ^ ancora no marcador real. Sem superuser no supabase_db, é o
# DONO quem contorna o RLS: a 0002 usa uma policy só-para-o-owner e a 0003
# suspende o FORCE só durante o seed org-null e o restaura.
for m in 0001_init 0002_affiliate_link_resolver 0003_seed_video_types; do
  { echo "SET ROLE openrate_owner;"; sed '/^-- migrate:down/,$d' "db/migrations/$m.sql"; echo "RESET ROLE;"; } \
    | docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f -
done
```

> Ou simplesmente rode `bash deploy/first-up.sh` (idempotente) — ele faz tudo
> isto (roles, schema, 0001 como owner, 0002/0003 como postgres, bucket, build,
> deploy) automaticamente.

**Validação (o que confirma sucesso):**

```bash
# 27 tabelas, 1 view, 64 policies no schema openrate
docker exec -i "$CID" psql -U postgres -d postgres -tAc \
  "select
     (select count(*) from information_schema.tables  where table_schema='openrate' and table_type='BASE TABLE') as tabelas,
     (select count(*) from information_schema.views   where table_schema='openrate') as views,
     (select count(*) from pg_policies                where schemaname='openrate') as policies;"

# a role de runtime SEM claims não enxerga nada (RLS ativo) — deve retornar 0
docker exec -i "$CID" psql "postgresql://openrate_app:TROQUE_SENHA_APP@localhost:5432/postgres" -tAc \
  "select count(*) from openrate.organizations;"

# a role de runtime NÃO alcança outros schemas — deve dar 'permission denied'
docker exec -i "$CID" psql "postgresql://openrate_app:TROQUE_SENHA_APP@localhost:5432/postgres" -tAc \
  "select count(*) from auth.users;" || echo "OK: bloqueado como esperado"
```

Guarde `TROQUE_SENHA_APP` para a env var `OPENRATE_DB_PASSWORD` da stack (Etapa B).

### A.5 — Bucket, lifecycle e usuário no MinIO

Seguir `deploy/runbook.md` **passo 4** (cria bucket `openrate-media`, lifecycle de 30 dias em `raw/`, usuário `openrate-app` com policy restrita, CORS para a origem do PWA). Guardar a secret key para `S3_SECRET_KEY`.

**Fim da Etapa A:** o schema, o bucket, o volume e o DNS estão prontos e validados; nenhum serviço novo foi iniciado; nada da produção existente foi alterado.

---

## Etapa B — Buildar as imagens e subir a stack

A stack `deploy/openrate.yaml` referencia `talkhub/openrate-api:latest`, `-worker`, `-web`, `-bullboard`. O código dessas imagens já existe (`apps/*` + `Dockerfile`s). A sequência de build no servidor é:

```bash
cd /opt/apps/openrate.talkhub.me
git pull                                   # traz apps/ + Dockerfiles
SHA=$(git rev-parse --short HEAD)

# build local no manager (mesmo fluxo dos outros talkhub/*), tag latest + SHA p/ rollback
docker build -t talkhub/openrate-api:latest       -t talkhub/openrate-api:$SHA       -f apps/api/Dockerfile .
docker build -t talkhub/openrate-worker:latest    -t talkhub/openrate-worker:$SHA    -f apps/worker/Dockerfile .
docker build -t talkhub/openrate-web:latest       -t talkhub/openrate-web:$SHA       -f apps/web/Dockerfile .
docker build -t talkhub/openrate-bullboard:latest -t talkhub/openrate-bullboard:$SHA -f apps/bullboard/Dockerfile .
```

Depois, **deploy pelo Portainer** (é o que já está configurado na VPS):

1. Portainer → **Stacks** → **Add stack** → nome **`openrate`**.
2. **Web editor** → colar `deploy/openrate.yaml`.
3. **Environment variables** → preencher conforme `deploy/.env.example` (`OPENRATE_DB_PASSWORD`, `OPENRATE_REDIS_PASSWORD`, `SUPABASE_*`, `S3_*`, `ANTHROPIC_API_KEY`, `ASAAS_*`, `EVOLUTION_*`, `BULLBOARD_BASICAUTH`).
4. **Deploy the stack** e acompanhar até `1/1 healthy`:

```bash
docker service ls | grep openrate
docker service logs -f openrate_openrate_api
```

**Smoke tests** (runbook passo 8): `curl https://openrate-api.talkhub.me/health` (200), painel em `https://openrate.talkhub.me`, Bull Board em `https://openrate-queues.talkhub.me` (401 sem credencial, 200 com).

> Alternativa a `Add stack` manual: apontar a stack do Portainer para este **repositório Git** (Stacks → Add stack → *Repository*), com auto-update por webhook/polling — assim cada `git push` na branch redeploya. Requer as imagens já buildadas (ou um passo de build no fluxo). O caminho "Web editor + build local" acima é o que mais se aproxima do padrão atual das outras stacks `talkhub/*`.

---

## Ordem recomendada

1. **Etapa A** → valida banco + storage no ambiente real, sem risco para a produção.
2. **Etapa B** → build das imagens (`apps/*` já existem) e stack no ar via Portainer, `/health` verde.
3. Antes do go-live, revisar os pendentes de segurança/negócio: adicionar Web Push (VAPID) só como canal secundário, provisionar a instância Evolution `openrate`, conferir os nomes de entrypoint/certresolver do Traefik do servidor, e travar as decisões de comissão/payout (Sprints 4-5).
