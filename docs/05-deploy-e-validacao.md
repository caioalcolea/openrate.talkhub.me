# 05 — Deploy e Validação (a partir do Git, na VPS)

> Como colocar na VPS **o que existe hoje no repositório** para validar, e o que falta para o stack subir por completo. Complementa [`../deploy/runbook.md`](../deploy/runbook.md) (procedimento detalhado) e [`04-sprints.md`](04-sprints.md) (Sprint 0).

## O que dá para validar agora × o que depende de código

Este repositório contém **especificação, arquitetura, a migration do banco e a definição da stack** — ainda **não há código de aplicação** (`apps/api`, `apps/web`, `apps/worker`, `apps/bullboard`) nem `Dockerfile`s. Consequência direta:

| Camada | Estado | Dá para validar hoje? |
|---|---|---|
| Migration do schema `openrate` (`db/migrations/0001_init.sql`) | Pronta e testada | **Sim** — aplica no `supabase_db` real e valida RLS/estrutura |
| Bucket `openrate-media` no MinIO (+ lifecycle, usuário) | Definido no runbook | **Sim** — cria e confere |
| DNS + volume + rede | Definidos | **Sim** |
| Stack `openrate` (5 serviços) | YAML pronto | **Não ainda** — as imagens `talkhub/openrate-*:latest` só existem depois da **Sprint 0** (esqueletos das apps) |

Ou seja: o "deploy completo" tem duas etapas. **Etapa A (agora)** provisiona e valida a infra do OpenRate sem subir containers de app. **Etapa B (após Sprint 0)** builda as imagens e sobe a stack pelo Portainer — o `deploy/runbook.md` cobre B ponta a ponta.

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

# criar as roles (owner p/ migração + app p/ runtime) e o schema — como postgres
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE openrate_owner LOGIN PASSWORD 'TROQUE_SENHA_OWNER'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 3;
CREATE ROLE openrate_app LOGIN PASSWORD 'TROQUE_SENHA_APP'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
CREATE SCHEMA IF NOT EXISTS openrate AUTHORIZATION openrate_owner;
ALTER ROLE openrate_owner SET search_path = openrate;
ALTER ROLE openrate_app   SET search_path = openrate;
REVOKE CREATE ON SCHEMA public FROM openrate_app;
REVOKE CREATE ON SCHEMA public FROM openrate_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM openrate_app;
SQL

# aplicar a migration (corta o bloco -- migrate:down; ^ ancora no marcador real)
sed '/^-- migrate:down/,$d' db/migrations/0001_init.sql > /tmp/0001_up.sql
docker cp /tmp/0001_up.sql "$CID":/tmp/0001_up.sql
docker exec -i "$CID" psql -U openrate_owner -d postgres -v ON_ERROR_STOP=1 --single-transaction -f /tmp/0001_up.sql
docker exec -i "$CID" rm /tmp/0001_up.sql
```

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

## Etapa B — Subir a stack (após a Sprint 0)

A stack `deploy/openrate.yaml` referencia `talkhub/openrate-api:latest`, `-worker`, `-web`, `-bullboard`. Essas imagens **precisam existir** — são o entregável da **Sprint 0** (esqueletos NestJS/Next(PWA)/worker/Bull Board com `/health`, ver `04-sprints.md`). Enquanto elas não forem buildadas, o deploy da stack falha em `pull image`.

Depois que a Sprint 0 existir no repositório, a sequência é:

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

1. **Etapa A** agora → valida banco + storage no ambiente real, sem risco para a produção.
2. **Sprint 0** (gerar os esqueletos `apps/*` + Dockerfiles) → produz as imagens.
3. **Etapa B** → stack no ar, `/health` verde, base para as sprints seguintes.
