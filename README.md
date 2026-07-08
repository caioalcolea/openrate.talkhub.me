# OpenRate

**OpenRate** é uma plataforma **SaaS multi-tenant** que transforma o atendente de loja física em **creator de conteúdo (UGC)**: a IA gera roteiros de vídeo por produto, o atendente grava com um **overlay-guia** no celular (PWA), o vídeo bruto é editado automaticamente (legenda + marca d'água) por um worker, é publicado em múltiplas plataformas com um **link de afiliado rastreável**, e cada **venda confirmada** vira **comissão rateada e paga via Pix**.

> Domínio de produção: **openrate.talkhub.me** · Codinome anterior: "Loja Creator".
> Foco atual do repositório: **preparo para produção**.

---

## Índice

1. [O que é o OpenRate](#1-o-que-é-o-openrate)
2. [Arquitetura](#2-arquitetura)
3. [Stack e requisitos](#3-stack-e-requisitos)
4. [Estrutura de pastas](#4-estrutura-de-pastas)
5. [Desenvolvimento local](#5-desenvolvimento-local)
6. [Variáveis de ambiente](#6-variáveis-de-ambiente)
7. [Banco de dados](#7-banco-de-dados)
8. [Deploy em produção](#8-deploy-em-produção)
9. [Testes](#9-testes)
10. [Endpoints da API por módulo](#10-endpoints-da-api-por-módulo)
11. [Integrações da fase Escala](#11-integrações-da-fase-escala)

---

## 1. O que é o OpenRate

Lojas físicas (varejo, suplementos, pet shops, etc.) têm produtos e vendedores, mas não têm um processo estruturado para gerar conteúdo de vídeo que venda nas redes sociais. O OpenRate fornece o **roteiro** (via IA), o **fluxo de gravação guiada**, a **edição do vídeo bruto** e o **rastreamento da receita** gerada por cada vídeo/creator — e fecha o ciclo pagando comissão via **Pix**.

### Fluxo ponta a ponta (golden path)

1. **Bootstrap** do primeiro `super_admin` → cria **organização** → entra na org (`switch-org`) → cria **loja** → cadastra **produto**.
2. IA gera **ideias de vídeo** por produto (hook, roteiro passo a passo, legenda, hashtags, duração alvo) — job assíncrono no worker.
3. *(PWA)* O atendente escolhe uma ideia; a tela de gravação exibe **overlay-guia** (teleprompter/checklist) baseado no roteiro.
4. O vídeo bruto é enviado por **upload resumível direto ao MinIO** (não passa pela API).
5. O **worker** processa: valida (`ffprobe`) → transcreve (Whisper) → transcodifica (`ffmpeg`, MP4/H.264 + legenda queimada + marca d'água) → gera thumbnail → marca o vídeo como `ready`.
6. O gestor **aprova** o vídeo; o atendente **publica** e **gera o link de afiliado rastreável** (`/r/:code`).
7. Cliques no link são contados; **vendas confirmadas** (importação CSV ou lançamento) disparam o **motor de comissão** (regra mais específica vence), que gera lançamentos para creator/loja/plataforma.
8. O **fechamento de período** consolida os lançamentos em **payouts** por creator; após aprovação, sai o **Pix**.
9. **Metas** diárias/semanais e **gamificação** (achievements) mantêm o engajamento dos atendentes.

### Papéis (roles)

| Role | Quem é | Principais ações |
|---|---|---|
| `super_admin` | Equipe OpenRate | Catálogo global, gestão de orgs, act-as-org. Nasce **sem** organização (`organization_id NULL`). |
| `owner` | Dono da rede de lojas | Visão de todas as lojas, metas, regras de comissão, fechamento e payouts. |
| `manager` | Gerente de loja | Aprova vídeos, cadastra produtos, importa vendas, define metas. |
| `attendant` | Vendedor/creator | Grava vídeos, publica, acompanha comissões, ranking e Pix. |

### Diferenciais

- **Escopo de produto** (`store` / `organization` / `platform`) e **origem** (`integration` / `manual` / `platform`): o atendente monetiza tanto o catálogo da própria org quanto o catálogo global da plataforma.
- **Pipeline de vídeo híbrido**: conteúdo 100% gravado por humanos (câmera real, produto físico) com pós-produção assistida pelo worker próprio — diferente de vídeo 100% sintético por IA.
- **Conectores de publicação plugáveis**: cada rede é um adapter isolado.
- **Motor de comissão por especificidade**: regras podem ser globais, por organização, loja, produto ou categoria; a **mais específica sempre vence**.

---

## 2. Arquitetura

### Monorepo

Monorepo **pnpm@10 + Turborepo** (Node >= 20). `pnpm-workspace.yaml` mapeia `apps/*` e `packages/*`; `tsconfig.base.json` é compartilhado (ES2022, `strict`, decorators para o NestJS). Scripts na raiz (todos via Turbo): `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm dev` (paralelo) e `pnpm ci` (`typecheck && build && test`).

### Aplicações e pacotes

| App/Pacote | Nome | Papel |
|---|---|---|
| `apps/api` | `@openrate/api` | **NestJS 10** — API REST (prefixo `/v1`), auth própria HS256, RLS por request. |
| `apps/web` | `@openrate/web` | **Next.js 14 (App Router)** — painel admin (desktop) **e** PWA do atendente (mobile). |
| `apps/worker` | `@openrate/worker` | **BullMQ** + FFmpeg + whisper — processamento de vídeo, IA, comissão e notificações. |
| `apps/bullboard` | `@openrate/bullboard` | **Bull Board** (Express) — observabilidade das filas. |
| `packages/shared` | `@openrate/shared` | Enums, schemas Zod, contrato do JWT, filas e **motor de comissão** (código isomórfico). |

### Fluxo de dados

- A **API só enfileira** jobs (BullMQ); o **worker consome**.
- **Uploads não passam pela API**: ela **pré-assina** URLs S3 e o navegador (PWA) envia direto ao MinIO (multipart resumível em chunks de 8 MB). O worker baixa o bruto, processa e sobe o final/thumb.
- **Correlation id** ponta a ponta: gerado no request da API (`x-request-id`) e propagado para os jobs (`JobTenant.correlationId`).

### Filas BullMQ

As **7 filas** são definidas uma única vez em `packages/shared/src/queues.ts` (fonte da verdade de nomes, `jobId`s determinísticos, payloads tipados, retries/backoff e concorrência padrão). O worker (`apps/worker/src/main.ts`) registra um `Worker` por fila; a concorrência efetiva pode ser sobreposta por env `CONCURRENCY_*`.

| Fila | Função | Retries/backoff | Concorrência padrão | Estado |
|---|---|---|---|---|
| `video-processing` | ffprobe → Whisper → ffmpeg (legenda + marca d'água) → thumbnail | 3 / 30s | 1 | Implementada |
| `ai-script-generation` | Chamada ao Claude → valida com Zod → grava `video_ideas` | 4 / 15s | 2 | Implementada |
| `commission-settlement` | Consolida comissões de creator vencidas do período em `payouts` | 2 / 300s | 1 | Implementada |
| `notifications` | Renderiza template e envia via Evolution (WhatsApp); demais canais marcados in-app | 5 / 10s | 5 | Implementada |
| `metrics-sync` | Coleta views/likes das publicações (Browserless) | 3 / 60s | 2 | **Stub** (fase Escala) |
| `payout-pix` | Payout Pix via Asaas (idempotency = `payoutId`; **sem retry automático**) | 1 | 1 | **Stub** (fase Escala) |
| `olist-sync` | Conector ERP Olist/Tiny (catálogo/vendas de balcão) | 3 / 60s | 1 | **Stub** (fase Escala) |

> `jobId` determinístico faz o BullMQ descartar duplicatas enquanto o job existir; a **idempotência do efeito** (UNIQUE/UPSERT/idempotency key) é sempre garantida no banco/serviço externo, nunca só pelo `jobId`.

### Multi-tenancy e RLS

Schema **`openrate`** isolado no Postgres 15 **compartilhado** (container `supabase_db`), tratado como um Postgres comum (sem depender de features do Supabase).

- **RLS de duas vias**: toda tabela com `organization_id` tem `ENABLE` + **`FORCE ROW LEVEL SECURITY`** e as policies `tenant_isolation` (linha visível quando `organization_id = current_org_id()`) e `super_admin_all`. Tabelas de catálogo global têm `platform_read` (linhas com `organization_id IS NULL`); `users` tem `self_read`; `organizations` tem `org_self_read`/`org_self_update`.
- A API valida o JWT e injeta os claims **por transação** via `SELECT set_config('request.jwt.claims', …, true)` (`PgService.withTenant`, `is_local=true` — não vaza no pool). As funções `current_org_id()`/`current_user_role()`/`is_super_admin()` derivam o tenant desse GUC.
- **Modelo de confiança**: o RLS é isolamento de consulta (defense-in-depth); a **fronteira real de segurança é a API** (valida o JWT antes de injetar os claims). Toda query é parametrizada.

### Storage MinIO

MinIO reaproveitado (S3-compatível), **bucket dedicado `openrate-media`**, região `eu-south`, path-style. Prefixos (`packages/shared/src/index.ts`): `raw/` (bruto, lifecycle de expiração em 30 dias), `final/`, `thumbs/`, `legal/` e `assets/` (imagens de produto). Chave do bruto: `raw/{org}/{store}/{video}/source.ext`.

### Autenticação própria HS256

Auth é **própria da API** (sem gotrue). Fluxo:

1. A senha é guardada em `openrate.users.password_hash` com **scrypt nativo do Node** (`apps/api/src/common/password.ts`, formato `scrypt$<saltHex>$<hashHex>`, comparação `timingSafeEqual`).
2. A API **assina e valida seu próprio JWT HS256** com `JWT_SECRET`, no shape de claims que o guard e o RLS esperam: `app_metadata.{product:'openrate', org_id, store_id, role}` (`packages/shared/src/auth.ts`).
3. `login`/`bootstrap` acontecem **sem** claim de tenant (pré-autenticação), via funções `SECURITY DEFINER` donas de `openrate_owner` (`auth_find_user`, `bootstrap_super_admin`).
4. **Refresh revalida no banco** (`auth_find_user_by_id`): o `POST /v1/auth/refresh` recarrega o usuário e recusa conta **desativada** e reflete **rebaixamento de papel** — uma revogação passa a valer em no máximo 1 ciclo de access (12 h), não nos 30 dias do refresh. `super_admin` preserva o *act-as-org* do token.
5. **Bootstrap protegido**: `POST /v1/auth/bootstrap` exige o header `x-bootstrap-token` igual a `BOOTSTRAP_TOKEN` (comparação em tempo constante); sem o token configurado o endpoint fica **desabilitado** (fail-closed) — evita que um anônimo tome o 1º `super_admin` na janela de deploy.
6. **Rate limit** (`@nestjs/throttler`): 120 req/min global por IP e limites estritos nas rotas públicas de auth (login 10, refresh 30, bootstrap 5 por min) contra brute-force/credential-stuffing e DoS de scrypt. A API roda com `trust proxy` para enxergar o IP real atrás do Traefik.
7. **Fail-closed**: em produção a API recusa subir com `JWT_SECRET` (< 32 chars ou default), `S3_ACCESS_KEY`/`S3_SECRET_KEY`, `DATABASE_URL`/`REDIS_URL` de dev ou `BOOTSTRAP_TOKEN` ausentes (`assertProductionEnv`); o worker tem checagem equivalente.
8. **Auditoria**: um `AuditInterceptor` global grava toda mutação bem-sucedida em `audit_log` (append-only), redigindo PII financeira (pix/cpf/cnpj/chave/…). O Bull Board tem basic auth de **aplicação** (2ª camada além do Traefik).

### Rede e DNS interno

A overlay `talkhub` é **externa** (`external: true`); numa rede externa o Swarm registra cada serviço pelo nome completo `<stack>_<serviço>`. Por isso o Redis desta stack resolve como **`openrate_openrate_redis:6379`** e os serviços reaproveitados são `supabase_db:5432`, `minio_minio:9000`, `evolution_evolution_api:8080`, `browserless_browserless:3000`.

---

## 3. Stack e requisitos

| Camada | Tecnologia |
|---|---|
| Runtime | Node >= 20, TypeScript 5.7, pnpm 10, Turborepo 2 |
| API | NestJS 10 (`platform-express`), pg, ioredis, bullmq, jsonwebtoken, zod, pino |
| Web | Next.js 14.2, React 18, Tailwind 3 (`output: 'standalone'`, `transpilePackages: ['@openrate/shared']`) |
| Worker | bullmq, `@aws-sdk/client-s3`, `@anthropic-ai/sdk`, axios, pg — **FFmpeg** e **whisper** (na imagem) |
| Bull Board | `@bull-board/express` + Express |
| Banco | PostgreSQL 15 (schema `openrate`, RLS) |
| Filas | Redis 7 dedicado (`maxmemory-policy noeviction`, `requirepass`) |
| Storage | MinIO (S3-compatível) |
| IA | Anthropic Claude (`claude-sonnet-5` → fallback `claude-haiku-4-5-20251001`) |
| Proxy/TLS | Traefik v3 (Let's Encrypt) |
| Orquestração | Docker Swarm (nó manager único) |

**Requisitos de desenvolvimento:** Docker + Docker Compose (dependências locais), Node >= 20 e pnpm 10 (apps rodam no host).

**Requisitos de produção:** nó Docker Swarm manager na rede overlay `talkhub`, com Postgres compartilhado (`supabase_db`), MinIO (`minio_minio`), Evolution API e Browserless já provisionados, e Traefik roteando por Host header.

---

## 4. Estrutura de pastas

```
openrate.talkhub.me/
├── apps/
│   ├── api/            NestJS — API REST (/v1), auth própria, RLS por request
│   │   ├── src/auth/           jwt.guard.ts, roles.decorator.ts
│   │   ├── src/common/         pg.service.ts, s3.ts, env.ts, password.ts, tenant.ts,
│   │   │                       commission-ingest.ts, csv.ts, pdf.ts, notify.ts, audit.interceptor.ts, zod.pipe.ts
│   │   ├── src/modules/        1 arquivo por domínio (auth, orgs, stores, users, products, …)
│   │   ├── src/test/           setup.ts + integration.test.ts (RLS/idempotência/reconciliação)
│   │   └── Dockerfile
│   ├── web/            Next.js — painel (desktop) + PWA do atendente
│   │   ├── app/(panel)/         painel admin (sidebar)
│   │   ├── app/(app)/app/       PWA do atendente (bottom-nav)
│   │   ├── lib/                 api.ts, auth.tsx, upload.ts, recording.ts, idb.ts, format.ts
│   │   ├── components/          toast, modal, product-form, notifications-bell, register-sw, …
│   │   ├── public/             manifest.webmanifest, sw.js, icons/
│   │   └── Dockerfile
│   ├── worker/         BullMQ + FFmpeg + whisper
│   │   ├── src/processors/      video-processing, ai-script-generation, settlement, notifications, stubs
│   │   ├── src/lib/            claude, ffmpeg, whisper, evolution, s3, pg, queues, env, logger
│   │   ├── src/healthcheck.ts  (Redis PING + Postgres SELECT 1)
│   │   └── Dockerfile
│   └── bullboard/      Bull Board (Express) + Dockerfile
├── packages/
│   └── shared/         @openrate/shared
│       └── src/        enums.ts, auth.ts, queues.ts, schemas.ts, commission.ts, validators.ts, index.ts
├── db/
│   ├── migrations/     0001_init.sql  (migration ÚNICA consolidada)
│   └── dev-init.sql    bootstrap do Postgres de DEV (roles owner/app, schema, pgcrypto)
├── deploy/
│   ├── first-up.sh     primeiro deploy idempotente (roles → schema → migration → MinIO → build → stack → smoke)
│   ├── openrate.yaml   stack Docker Swarm (5 serviços) — pronta para o Portainer
│   ├── .env.example    variáveis da stack (placeholders)
│   └── runbook.md      procedimento passo a passo de deploy/rollback
├── docker-compose.dev.yml   dependências locais (Postgres, Redis, MinIO + bucket)
├── .env.dev.example    variáveis de desenvolvimento
├── redeploy.sh         redeploy limpo sem cache (escopo restrito ao OpenRate)
├── turbo.json          pipeline build/typecheck/test/dev
├── tsconfig.base.json
└── README.md
```

---

## 5. Desenvolvimento local

O `docker-compose.dev.yml` sobe **só as dependências** (Postgres 15 semeado por `db/dev-init.sql`, Redis 7 com `noeviction`, MinIO + criação do bucket `openrate-media`). As aplicações rodam **no host** com `pnpm dev`.

```bash
# 1) Subir as dependências (Postgres + Redis + MinIO + bucket)
docker compose -f docker-compose.dev.yml up -d

# 2) Aplicar a migration ÚNICA (0001_init.sql) no Postgres de dev.
#    Corte o bloco "-- migrate:down" (ancorado em início de linha) e aplique só o "up":
docker compose -f docker-compose.dev.yml exec -T db \
  psql -U postgres -d openrate -v ON_ERROR_STOP=1 \
  < <(sed '/^-- migrate:down/,$d' db/migrations/0001_init.sql)

# 3) Configurar o ambiente e instalar
cp .env.dev.example .env      # preencha/ajuste (defaults já servem para dev)
pnpm install

# 4) Rodar tudo em paralelo (api, web, worker, bullboard) via Turbo
pnpm dev
```

Portas locais: Postgres `5432`, Redis `6379`, MinIO `9000` (console `9001`). O `db/dev-init.sql` reproduz o ambiente real criando as roles `openrate_owner`/`openrate_app`, o schema `openrate` e a extensão `pgcrypto` — para a migration aplicar igual à produção.

**Verificação:** `pnpm ci` (typecheck + build + test). O CI (`.github/workflows/ci.yml`) roda exatamente isso em cada push/PR, com um Postgres de serviço e `DATABASE_URL` setado (para os testes de integração). Não há step de deploy — o deploy é manual na VPS.

---

## 6. Variáveis de ambiente

### 6.1 Desenvolvimento (`.env.dev.example`)

| Variável | Descrição |
|---|---|
| `OPENRATE_DB_PASSWORD` | Senha da role de runtime `openrate_app` (dev). |
| `DATABASE_URL` | Conexão do app: `postgresql://openrate_app:…@db:5432/openrate`. |
| `REDIS_URL` | Conexão do Redis local: `redis://redis:6379`. |
| `JWT_SECRET` | Segredo HS256 (qualquer valor em dev). |
| `S3_ENDPOINT` | Endpoint interno do MinIO (`http://minio:9000`). |
| `S3_PUBLIC_ENDPOINT` | Endpoint público (`http://localhost:9000`). |
| `S3_BUCKET` | `openrate-media`. |
| `S3_REGION` | `eu-south`. |
| `S3_FORCE_PATH_STYLE` | `true`. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciais do MinIO (`minioadmin`/`minioadmin` em dev). |
| `ANTHROPIC_API_KEY` | Chave da Anthropic (placeholder em dev). |
| `AI_MODEL_PRIMARY` / `AI_MODEL_FALLBACK` | `claude-sonnet-5` / `claude-haiku-4-5-20251001`. |
| `ASAAS_API_KEY` / `ASAAS_BASE_URL` | Asaas (opcional; vazio desabilita). |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | WhatsApp (opcional). |
| `BROWSERLESS_URL` | Scraping de métricas (opcional). |
| `WHISPER_MODEL` | Modelo do Whisper (`small`). |

### 6.2 Produção — stack Swarm (`deploy/.env.example`)

Preenchidas na tela de deploy do Portainer e interpoladas no `deploy/openrate.yaml` via `${VAR}`. **Só placeholders no repositório — nunca valores reais.**

| Grupo | Variável | Descrição |
|---|---|---|
| Banco | `OPENRATE_DB_PASSWORD` | Senha da role de runtime `openrate_app`. |
| Redis | `OPENRATE_REDIS_PASSWORD` | `requirepass` do Redis dedicado (BullMQ). |
| Auth | `JWT_SECRET` | Segredo HS256 com que a API assina/valida o próprio JWT (**mín. 32 chars**). |
| Auth | `BOOTSTRAP_TOKEN` | Libera `POST /v1/auth/bootstrap` (header `x-bootstrap-token`). Obrigatório (fail-closed), **mín. 16 chars**. |
| S3/MinIO | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Credenciais do usuário dedicado `openrate-app` (não usar o root). |
| IA | `ANTHROPIC_API_KEY` | Chave da Anthropic (usada só pelo worker). |
| Pagamentos | `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN` | Asaas (payout Pix / webhook — fase Escala; só no worker). |
| ERP | `OLIST_API_KEY` | Olist/Tiny (conector ERP — fase Escala; só no worker). |
| Cessão de imagem | `DOCUSEAL_WEBHOOK_TOKEN` | Valida o webhook do Docuseal (fase Escala). |
| WhatsApp | `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Evolution API (notificações). |
| Flags Escala | `ASAAS_ENABLED`, `OLIST_ENABLED`, `METRICS_SYNC_ENABLED` | Habilitam os endpoints de disparo na API (só flags, não segredos). Default `false`. |
| Bull Board | `BULLBOARD_BASICAUTH` | `user:hash` bcrypt (`htpasswd -nbB`) para o basicauth do Traefik (borda). |
| Bull Board | `BULLBOARD_USER`, `BULLBOARD_PASSWORD` | Basic auth de **aplicação** (2ª camada; protege leste-oeste na overlay). |

**Fixos no `openrate.yaml`** (não precisam ir no `.env`): `DATABASE_URL` (`…@supabase_db:5432/postgres`, com `search_path=openrate` definido no nível da role), `REDIS_URL` (`redis://:…@openrate_openrate_redis:6379`), `DATABASE_POOL_MAX`, `S3_ENDPOINT` (`http://minio_minio:9000`), `S3_PUBLIC_ENDPOINT` (`https://bucketss3.talkhub.me`), `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `API_PUBLIC_URL`, `WEB_ORIGIN`, `AI_MODEL_PRIMARY/FALLBACK`, `EVOLUTION_API_URL`, `BROWSERLESS_URL`, `CONCURRENCY_*`, `WHISPER_MODEL`, `NEXT_PUBLIC_API_URL` e `TZ=America/Sao_Paulo`.

**Provisionamento (só no `first-up.sh`, não vão para a stack):** `OPENRATE_DB_OWNER_PASSWORD` (role de migração `openrate_owner`), `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (root do MinIO para criar bucket/usuário/policy) e `DB_SUPERUSER_PASSWORD` (usuário `postgres` do container do banco).

> As senhas que entram em URIs (DB/Redis) devem ser **URL-safe** (`[A-Za-z0-9._-]`); o `first-up.sh` valida e falha cedo se houver caractere reservado.

**Flags da fase Escala na API** (`apps/api/src/common/env.ts`): `ASAAS_ENABLED` / `OLIST_ENABLED` / `METRICS_SYNC_ENABLED` (`=true`) habilitam os endpoints de disparo (`/v1/integrations/*`, `/v1/payouts/:id/pay-pix`) — são **só flags**; os segredos ficam no worker. `DATABASE_POOL_MAX`, `API_PUBLIC_URL` e `WEB_ORIGIN` (allowlist de CORS em produção) também são lidos aqui.

---

## 7. Banco de dados

### Migration única consolidada

> **A partir de agora há UMA única migration: `db/migrations/0001_init.sql`.** As migrations anteriores (0002 resolver de link de afiliado, 0003 seed de tipos de vídeo, 0004 auth própria, 0005 limpeza do fallback de JWT, 0006 estrutura completa dos cadastros, 0007 refatoração de metas) foram **consolidadas nela**. `0001_init.sql` é o schema completo e definitivo do `openrate`.

O arquivo traz marcadores `-- migrate:up` / `-- migrate:down` (compatível com dbmate). Ao aplicar via psql direto, **corte o bloco down** com `sed '/^-- migrate:down/,$d'` (ancorado em início de linha) e rode `--single-transaction -v ON_ERROR_STOP=1` — nunca o arquivo inteiro, senão o bloco down apaga o schema recém-criado.

### Conteúdo do `0001_init.sql`

- **27 tabelas** + **1 view** (`v_goal_progress_daily`), organizadas por domínio:
  - **Multi-tenancy:** `organizations`, `stores`, `users`, `user_stores`
  - **Catálogo:** `brands`, `categories`, `products`, `product_images`, `product_variations`, `store_inventory`
  - **Conteúdo:** `video_types`, `video_ideas`, `videos`, `video_publications`, `affiliate_links`
  - **Financeiro:** `commission_rules`, `affiliate_sales`, `commission_entries`, `payouts`
  - **Engajamento:** `goals`, `achievements`, `user_achievements`
  - **CRM físico:** `customers`, `store_sales`
  - **Operação:** `integrations`, `notifications`, `audit_log`
- **Enums** de domínio (espelhados em `packages/shared/src/enums.ts`): `user_role`, `product_scope`, `product_origin`, `video_status`, `publication_platform`, `publication_status`, `sale_status`, `commission_entry_status`, `payout_status`, `goal_period`, `goal_metric`, `integration_provider`, `notification_channel`, `commission_beneficiary`, `org_plan`, `org_status`, `product_type`, `product_unit`, `commission_base`.
- **View** `v_goal_progress_daily` (`security_invoker=true`, herda RLS): progresso da meta diária por usuário, medindo a **métrica escolhida** (`videos_recorded`/`videos_published`/`views`/`affiliate_revenue`) contra `target_value`. Datas em `America/Sao_Paulo`.
- **RLS** com `ENABLE` + **`FORCE ROW LEVEL SECURITY`** e as policies descritas na seção 2; funções de tenant (`current_org_id`, `current_user_role`, `is_super_admin`, `jwt_claims`) e trigger `set_updated_at`.
- **Guard de pré-requisito:** a migration **aborta** se a role `openrate_app` não existir ou tiver `SUPERUSER`/`BYPASSRLS` (isso anularia o RLS).
- **Funções `SECURITY DEFINER`** (donas: `openrate_owner`; `EXECUTE` só para `openrate_app`):
  - `openrate.auth_find_user(email)` — lookup de login (hash + tenant), cross-tenant sem claim.
  - `openrate.auth_find_user_by_id(id)` — revalidação do usuário a cada refresh de token (active/role/org/loja do banco).
  - `openrate.bootstrap_super_admin(email, name, hash)` — cria o 1º super_admin e **auto-desabilita** (falha depois com `unique_violation`).
  - `openrate.click_affiliate_link(code)` — resolver público de `/r/:code` (incrementa `clicks_count`, retorna `destination_url`), via policy só-para-o-owner mantendo o FORCE ativo.
- **Seed** de `video_types` globais (`organization_id NULL`, lidos por qualquer org): Unboxing, Review, Antes e Depois, Demonstração, Tutorial.

### Roles do Postgres

- **`openrate_owner`** — dona do schema e das tabelas; aplica as migrations conectando **direto por TCP+senha** (o container `supabase_db` encerra a conexão em `SET ROLE` via supautils, por isso o owner cria os próprios objetos conectando como ele). Sua senha é tão sensível quanto um bypass total do RLS.
- **`openrate_app`** — role de **runtime** (`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`), não é dona de nenhum objeto, restrita ao schema `openrate` (`search_path` no nível da role) — assim o RLS **sempre** se aplica a ela.

### Motor de comissão

Lógica pura em `packages/shared/src/commission.ts` (coberta por testes):

- **Regra vencedora por especificidade** (`resolveRule`): pesos `product 16 > category 8 > store 4 > organization 2 > platform 1`, refletidos na coluna `GENERATED priority` de `commission_rules`. Empate resolvido de forma determinística por `id`.
- **Base do rateio** (`commissionBaseAmount`): `affiliate_payout` (comissão de afiliado, default) ou `gross_sale` (valor bruto), conforme `commission_rules.calc_base`.
- **Rateio** (`splitCommission`): garante `Σ parcelas == round2(base × Σpct/100)` e **nenhuma parcela negativa** (a plataforma absorve o resíduo de centavo).
- **Ingestão** (`apps/api/src/common/commission-ingest.ts`): `ingestConfirmedSale` é **idempotente por `external_id`** (dedupe de venda) e gera lançamentos creator/store/platform; `reverseSale` cria estornos (`reversal_of`). O worker `commission-settlement` consolida os lançamentos de creator com **carência vencida** do período em um `payout` por creator, sem duplicar (`payout_id IS NULL` e `status <> 'paid'`).

---

## 8. Deploy em produção

Docker Swarm em **nó manager único**, atrás do **Traefik**, na overlay externa `talkhub`. **Nenhuma porta publicada no host** — todo ingress entra pelo Traefik (80/443).

### Stack Swarm (`deploy/openrate.yaml`) — 5 serviços novos

| Serviço | Imagem | Recursos (limit) | Host / observação |
|---|---|---|---|
| `openrate_redis` | `redis:7-alpine` | 0.5 CPU / 512M | Redis dedicado (`noeviction`, `maxmemory 400mb`, `requirepass`). Volume `openrate_redis_data` (external). |
| `openrate_api` | `talkhub/openrate-api` | 1 CPU / 1024M | `openrate-api.talkhub.me` (`/v1`). Healthcheck em `/health`. |
| `openrate_worker` | `talkhub/openrate-worker` | 2 CPU / 3072M | Sem host público. Healthcheck `node dist/healthcheck.js`. Recebe os segredos de IA/Asaas/Evolution/Browserless (menor-privilégio: a API não recebe). |
| `openrate_web` | `talkhub/openrate-web` | 0.5 CPU / 512M | `openrate.talkhub.me` (painel + PWA). Healthcheck em `/api/health`. |
| `openrate_bullboard` | `talkhub/openrate-bullboard` | 0.25 CPU / 256M | `openrate-queues.talkhub.me` — **duas camadas** de basic auth: no Traefik (borda) **e** na aplicação (`BULLBOARD_USER/PASSWORD`, protege leste-oeste na overlay). |

Cada serviço tem `update_config` + `rollback_config` (`order: stop-first`, `failure_action: rollback`): se a nova task não ficar saudável em `monitor`, o Swarm **reverte automaticamente** em vez de deixar um deploy quebrado no ar.

**Serviços reaproveitados** (já em produção): Postgres `supabase_db` (schema `openrate`), MinIO `minio_minio` (bucket `openrate-media`, público `bucketss3.talkhub.me`), Evolution API `evolution_evolution_api` (WhatsApp), Browserless `browserless_browserless` (métricas — fase Escala) e Traefik.

### Hosts públicos

| Host | Serviço |
|---|---|
| `openrate.talkhub.me` | `openrate_web` (painel + PWA) |
| `openrate-api.talkhub.me` | `openrate_api` (`/v1`) |
| `openrate-queues.talkhub.me` | `openrate_bullboard` (basicauth) |
| `bucketss3.talkhub.me` | MinIO (URLs pré-assinadas) |

### Primeiro deploy (`deploy/first-up.sh`)

Idempotente, só operações **aditivas** (reexecutável — pula o que já existe). Rode a partir da raiz, no nó manager:

```bash
cp deploy/.env.example deploy/.env   # preencha os segredos
bash deploy/first-up.sh
```

Passos: (1) pré-checagens (docker, swarm manager, `.env`, senhas URL-safe); (2) DNS dos hosts (aviso); (3) volume `openrate_redis_data`; (4) Postgres — cria/atualiza as roles `openrate_owner`/`openrate_app` e o schema, e **aplica a migration `0001_init.sql` como `openrate_owner`** (conexão direta, sem `SET ROLE`); (5) MinIO — bucket `openrate-media` + lifecycle (`raw/` 30 dias) + usuário dedicado + policy restrita; (6) build das 4 imagens `talkhub/openrate-*` (tags `latest` + SHA do git); (7) `docker stack deploy` com `OPENRATE_IMAGE_TAG=$SHA`; (8) smoke tests (`/health`, painel, Bull Board 401).

### Redeploy limpo (`redeploy.sh`)

Rebuild **sem cache**, escopo **restrito ao OpenRate** — remove a stack, espera descer, remove **só** as imagens `talkhub/openrate-*` e chama o `first-up.sh` com `NO_CACHE=1`.

```bash
bash redeploy.sh                # preserva o volume das filas (openrate_redis_data)
bash redeploy.sh --wipe-redis   # zera também as filas do BullMQ
```

**Preserva sempre:** o banco (schema `openrate`), o bucket `openrate-media` e, por padrão, o volume do Redis. **Nunca** faz `docker system/image/volume/builder prune` global (o servidor é compartilhado com ~30 stacks). As imagens são taggeadas com o SHA do git para o Swarm detectar a mudança sem registry.

> Procedimento completo (DNS, roles/schema, MinIO, basicauth, rollback e checklist anti-conflito) em `deploy/runbook.md`.

---

## 9. Testes

- **Unit (shared)** — `packages/shared`: `commission.test.ts` (tabela-verdade do motor: especificidade da regra, base do rateio, invariante `Σ parcelas == base×Σpct` e não-negatividade) e `validators.test.ts` (CPF/CNPJ/CEP/telefone). Rodam com `node --test`, sem banco.
- **Integração (API)** — `apps/api/src/test/`: sobem o **schema real** (a migration) num Postgres descartável apontado por **`DATABASE_URL`**, criando as roles `openrate_owner`/`openrate_app` e aplicando as migrations como o owner (espelhando produção). Cobrem:
  - **Isolamento RLS** (tenant A não vê dados do tenant B; a role `openrate_app` é `NOSUPERUSER NOBYPASSRLS`, então o RLS é de fato exercitado);
  - **Idempotência** de `ingestConfirmedSale` (dedupe por `external_id`);
  - **Reconciliação** do rateio (lançamentos creator/store/platform batem com o motor e a soma fecha).
  - Sem `DATABASE_URL`, os testes de integração **se auto-pulam** (`hasTestDb()=false`), então `pnpm test` local não quebra.

O CI (`.github/workflows/ci.yml`) sobe um Postgres de serviço, define `DATABASE_URL` e roda `pnpm run typecheck && build && test` em cada push/PR.

```bash
pnpm test                                  # unit + integração (integração pula sem DATABASE_URL)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/openrate_test pnpm test   # inclui integração
```

---

## 10. Endpoints da API por módulo

Guard global `JwtAuthGuard` (`APP_GUARD`): exige `Authorization: Bearer`, valida o JWT HS256, confere `app_metadata.product === 'openrate'` e monta o `TenantContext` (`userId`, `orgId`, `storeId`, `role`, `correlationId`). `@Public()` dispensa auth; `@Roles(...)` exige papel mínimo (`super_admin` sempre passa); `@CurrentTenant()` injeta o contexto. Escritas tenant-scoped chamam `assertOrgContext()` → **400** quando não há org selecionada. Um `AuditInterceptor` global registra toda mutação bem-sucedida em `audit_log`.

Todas as rotas ficam sob **`/v1`**, exceto `/health` e `/r/:code`.

| Módulo | Rotas (papel mínimo entre parênteses; público onde indicado) |
|---|---|
| **health** | `GET /health` *(público — Postgres + Redis)* |
| **auth** | `POST /v1/auth/login` · `/refresh` · `/bootstrap` *(públicas; rate-limited; `bootstrap` exige `x-bootstrap-token`)* · `POST /v1/auth/switch-org` (act-as-org) · `POST /v1/auth/change-password` |
| **me** | `GET /v1/me` · `GET /v1/me/image-release` · `POST /v1/me/image-release/accept` · `PATCH /v1/me/pix` |
| **orgs** *(super_admin)* | `GET /v1/orgs` · `POST /v1/orgs` · `GET /v1/orgs/:id` · `PATCH /v1/orgs/:id` |
| **stores** | `GET /v1/stores` · `GET /v1/stores/:id` · `POST /v1/stores` *(owner)* · `PATCH /v1/stores/:id` *(owner)* |
| **users** | `GET /v1/users` · `GET /v1/users/:id` · `GET /v1/stores/:id/users` · `POST /v1/users/invite` · `PATCH /v1/users/:id` · `POST /v1/users/:id/reset-password` *(todos manager)* |
| **products** | `GET /v1/products` · `GET /v1/products/:id` · `POST` · `PATCH /:id` · `POST /:id/images` · `POST /:id/images/:imageId/primary` · `DELETE /:id/images/:imageId` · `POST /:id/variations` · `PATCH /:id/variations/:vid` · `DELETE /:id/variations/:vid` · `POST /:id/inventory` *(escritas: manager)* |
| **catalog** | `GET/POST /v1/brands` · `PATCH /v1/brands/:id` · `GET/POST /v1/categories` · `PATCH /v1/categories/:id` · `GET/POST /v1/video-types` · `PATCH /v1/video-types/:id` *(escritas: manager)* |
| **media** | `POST /v1/media/upload-url` *(manager — presigned PUT p/ imagens)* |
| **ideas** | `POST /v1/products/:id/generate-ideas` *(IA no worker)* · `GET /v1/products/:id/ideas` · `POST /v1/products/:id/ideas` *(manager)* · `PATCH /v1/ideas/:id` *(manager)* · `POST /v1/ideas/:id/duplicate` *(manager)* · `POST /v1/ideas/:id/select` |
| **videos** | `POST /v1/videos` (inicia upload) · `POST /v1/videos/:id/complete-upload` · `GET /v1/videos` · `GET /v1/videos/:id` · `GET /v1/videos/:id/download` · `POST /v1/videos/:id/approve` · `/reject` *(manager)* |
| **goals** | `GET /v1/goals` · `POST /v1/goals` *(manager)* · `GET /v1/goals/progress` |
| **notifications** | `GET /v1/notifications` · `POST /v1/notifications/read-all` · `POST /v1/notifications/:id/read` |
| **commission-rules** | `GET /v1/commission-rules` · `POST` *(owner)* · `POST /v1/commission-rules/simulate` |
| **publications** | `POST /v1/videos/:id/publications` · `GET /v1/publications` · `GET /r/:code` *(redirect público)* |
| **sales** | `POST /v1/affiliate-sales` *(manager)* · `/import` (CSV, manager) · `GET /v1/affiliate-sales` · `/export.csv` · `GET /v1/commission-entries` · `/export.csv` · `POST /v1/affiliate-sales/:id/cancel` *(manager)* |
| **settlements** | `POST /v1/settlements/close` *(owner — enfileira fechamento)* |
| **payouts** | `GET /v1/payouts` · `/export.csv` · `POST /v1/payouts/:id/pay-pix` *(manager)* · `GET /v1/payouts/:id/receipt` *(manager)* · `POST /v1/payouts/:id/approve` · `/pay` *(owner)* |
| **dashboard** | `GET /v1/dashboard` *(manager)* · `GET /v1/me/earnings` |
| **customers** | `GET /v1/customers` · `GET /v1/customers/:id` · `POST` · `PATCH /:id` *(escritas: manager)* |
| **store-sales** | `GET /v1/store-sales` · `POST /v1/store-sales` *(manager)* |
| **audit** | `GET /v1/audit-log` *(owner)* |
| **integrations** | `GET /v1/integrations` *(manager — flags)* · `POST /v1/integrations/metrics/sync` *(manager)* · `POST /v1/integrations/olist/sync` *(owner)* |
| **webhooks** | `POST /v1/webhooks/asaas` · `/docuseal` *(públicas — autenticadas por token próprio, fail-closed)* |

**super_admin (act-as-org):** nasce sem org; lista/cria orgs e chama `POST /v1/auth/switch-org { orgId }` para re-emitir o JWT com aquela org, operando como se pertencesse a ela.

---

## 11. Integrações da fase Escala

As integrações da fase **Escala** têm a **estrutura pronta e registrada** (payloads tipados, filas, endpoints, gating por env), mas a **lógica de negócio é stub** — logada, sem efeito colateral. Cada endpoint de disparo só enfileira quando a integração está **habilitada por env**; caso contrário responde **501 (Not Implemented)**.

| Integração | Fila / Rota | Gating (env) | Estado |
|---|---|---|---|
| **Asaas (Pix)** | `payout-pix` · webhook `POST /v1/webhooks/asaas` | `ASAAS_ENABLED=true` (API) + `ASAAS_API_KEY` (worker) | Processador stub (transfer com idempotency = `payoutId`, **sem retry automático**); webhook valida token mas ainda não processa. No MVP o payout é registrado manualmente. |
| **Olist/Tiny (ERP)** | `olist-sync` · `POST /v1/integrations/olist/sync` *(owner)* | `OLIST_ENABLED=true` (API) + `OLIST_API_KEY` (worker) | Processador stub: `kind='products'` (catálogo) / `kind='sales'` (vendas de balcão, `source='erp'`). Upsert idempotente por `external_id`. A comissão **nunca** deriva daqui — só de `affiliate_sales`. |
| **metrics-sync (Browserless)** | `metrics-sync` · `POST /v1/integrations/metrics/sync` *(manager)* | `METRICS_SYNC_ENABLED=true` | Processador stub: coleta views/likes das publicações no ar; APIs oficiais quando houver, Browserless como fallback. Métricas são **best-effort** e **nunca alimentam o financeiro**. |
| **Docuseal (cessão de imagem)** | webhook `POST /v1/webhooks/docuseal` · `GET/POST /v1/me/image-release` | `DOCUSEAL_WEBHOOK_TOKEN` | Webhook valida token (fail-closed); ainda não marca a assinatura nem faz gate de publicação. |
| **Evolution API (WhatsApp)** | `notifications` | `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | **Implementada** — o worker envia notificações (meta batida, vídeo aprovado/rejeitado, comissão creditada, payout pago) por template; canais não-WhatsApp ficam in-app. |

Os stubs vivem em `apps/worker/src/processors/stubs.ts` (`processMetricsSync`, `processPayoutPix`, `processOlistSync`) e são registrados no `apps/worker/src/main.ts` junto com os processadores reais — bastando plugar a lógica quando a fase Escala for puxada. O worker recebe os segredos dessas integrações (a API não, por menor-privilégio).