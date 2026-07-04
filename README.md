# OpenRate

Plataforma SaaS multi-tenant que transforma atendentes de lojas físicas em creators de conteúdo (UGC): a IA gera roteiros de vídeo por produto, o atendente grava com overlay-guia, o vídeo bruto é editado automaticamente (legenda + marca d'água), publicado em múltiplas plataformas com link de afiliado rastreável, e as vendas confirmadas viram comissão rateada e paga via Pix.

> Domínio de produção: **openrate.talkhub.me** · Codinome anterior: "Loja Creator".

**Produto 100% web.** O atendente usa um **PWA** (a mesma aplicação Next.js do painel, aberta no navegador do celular e instalável via "Adicionar à tela inicial") — sem publicação em loja de aplicativos. Câmera e gravação via `getUserMedia`/`MediaRecorder`; upload resumível direto ao MinIO; fila offline e cache de shell via service worker.

**Estado atual:** as 4 aplicações, os Dockerfiles e a stack Docker Swarm existem e estão **no ar** (5/5 serviços). Autenticação própria (login/refresh/bootstrap emitindo JWT), MVP (roteiros de IA → gravação → aprovação) e a fase Dinheiro (links de afiliado, importação de vendas, motor de comissão, fechamento de período, payouts, dashboards) implementados. A fase Escala (payout automático via Asaas, metrics-sync via Browserless, conectores Olist/marketplaces) está com stubs, seguindo `docs/04-sprints.md`.

---

## Estrutura do monorepo

Monorepo **pnpm@10 + Turborepo** (Node >= 20). `pnpm-workspace.yaml` mapeia `apps/*` e `packages/*`. `tsconfig.base.json` compartilhado (ES2022, `strict`, decorators para o NestJS).

```
openrate.talkhub.me/
├── apps/
│   ├── api/         NestJS 10 — API REST (prefixo /v1), auth própria, RLS por request
│   ├── web/         Next.js 14 (App Router) — painel (desktop) + PWA do atendente
│   ├── worker/      BullMQ + FFmpeg + faster-whisper — processamento de vídeo/IA/comissão
│   └── bullboard/   Bull Board (Express) — observabilidade das filas
├── packages/
│   └── shared/      @openrate/shared — enums, schemas Zod, contrato do JWT, filas e motor de comissão (isomórfico)
├── db/
│   ├── migrations/  0001 init · 0002 resolver de link de afiliado · 0003 seed de tipos de vídeo · 0004 auth própria
│   └── dev-init.sql bootstrap do banco para dev local (roles, schema, pgcrypto)
├── deploy/          first-up.sh, openrate.yaml (stack Swarm), .env.example, runbook.md
├── docs/            01-06 (análise, arquitetura, banco, sprints, deploy, 1º deploy)
├── docker-compose.dev.yml   dependências para rodar as apps no host (Postgres, Redis, MinIO)
├── redeploy.sh      redeploy limpo sem cache (escopo restrito ao OpenRate)
├── turbo.json       pipeline de build/typecheck/test/dev
└── README.md
```

Scripts na raiz (todos via Turbo): `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm dev` (paralelo) e `pnpm ci` (`typecheck && build && test`).

---

## Arquitetura em uma frase

Uma stack Swarm nova (`openrate`) com **5 serviços** — `openrate_api` (NestJS), `openrate_worker` (BullMQ + FFmpeg + faster-whisper), `openrate_web` (Next.js: painel **e** PWA), `openrate_redis` (filas, dedicado com `noeviction`) e `openrate_bullboard` (observabilidade das filas) — que **reaproveita** serviços já em produção no servidor Talkhub: **Postgres do Supabase** (`supabase_db`, schema `openrate` isolado), **MinIO** (`minio_minio`, bucket `openrate-media`), **Evolution API** (WhatsApp), **Browserless** (scraping de métricas), **Asaas** (Pix), **Docuseal** (termo de cessão de imagem) e **Anthropic** (IA de roteiros), tudo atrás do **Traefik** existente.

**Autenticação é própria da API** (o gotrue compartilhado tem login por e-mail desativado): a API verifica hash de senha com **scrypt** contra `openrate.users` e assina seu **próprio JWT HS256** com `SUPABASE_JWT_SECRET`, no mesmo formato de claims que o RLS espera (`app_metadata.{product,org_id,store_id,role}`), então as policies do banco funcionam sem alteração.

**Rede e DNS interno:** a overlay `talkhub` é **externa** (`external: true`); por isso os serviços registram pelo nome completo `<stack>_<serviço>` e se referenciam assim — ex.: o Redis é `openrate_openrate_redis:6379`, e os reaproveitados são `supabase_db:5432`, `minio_minio:9000`, `evolution_evolution_api:8080`, `browserless_browserless:3000`.

**Princípios de coexistência com a produção** (detalhados em `docs/01` §4 e `deploy/runbook.md`):

- Zero portas publicadas no host — todo tráfego entra pelo Traefik (80/443).
- Nomes de stack/serviço/volume/router únicos e prefixados `openrate_`.
- Redis próprio (o global compartilhado não tem `noeviction`, requisito do BullMQ).
- Schema `openrate` isolado no Postgres compartilhado; role de runtime `openrate_app` sem privilégios sobre outros schemas e sujeita a RLS (`FORCE ROW LEVEL SECURITY`).
- Limites de CPU/memória em todos os serviços — o nó é único e compartilhado com ~20-30 stacks.
- `redeploy.sh` **nunca** faz `docker system/image/volume/builder prune` global; remove apenas as imagens `talkhub/openrate-*`.

---

## Hosts públicos

| Host | Serviço | Observação |
|---|---|---|
| `openrate.talkhub.me` | `openrate_web` | Painel + PWA do atendente |
| `openrate-api.talkhub.me` | `openrate_api` | API REST (`/v1`) |
| `openrate-queues.talkhub.me` | `openrate_bullboard` | Bull Board, protegido por basicauth no Traefik |
| `bucketss3.talkhub.me` | MinIO (reaproveitado) | Endpoint S3 público (URLs pré-assinadas) |

---

## Modelo de dados & multi-tenancy

Schema **`openrate`** dentro do `supabase_db` (Postgres 15): **27 tabelas + 1 view** (`v_goal_progress_daily`), **13 enums**, organizado por domínio — multi-tenancy (`organizations`, `stores`, `users`, `user_stores`), catálogo (`brands`, `categories`, `products`, `product_images`, `product_variations`, `store_inventory`), conteúdo (`video_types`, `video_ideas`, `videos`, `video_publications`, `affiliate_links`), financeiro (`commission_rules`, `affiliate_sales`, `commission_entries`, `payouts`), engajamento (`goals`, `achievements`, `user_achievements`), CRM físico (`customers`, `store_sales`) e operação (`integrations`, `notifications`, `audit_log`). Detalhes e diagramas em [`docs/03-banco-de-dados.md`](docs/03-banco-de-dados.md).

**Isolamento (RLS de duas vias):** toda tabela com `organization_id` tem `ENABLE` + **`FORCE ROW LEVEL SECURITY`** e as policies `tenant_isolation` (linha visível quando `organization_id = current_org_id()`) e `super_admin_all`. Tabelas de catálogo global têm `platform_read` (linhas com `organization_id IS NULL`); `users` tem `self_read`. A API valida o JWT e injeta os claims por transação via `SELECT set_config('request.jwt.claims', …, true)` (`PgService.withTenant`), de onde as funções `current_org_id()`/`current_user_role()`/`is_super_admin()` derivam o tenant.

**Roles do Postgres:** `openrate_owner` (dono do schema e das migrations; conecta direto por TCP) e `openrate_app` (runtime — `NOSUPERUSER`, `NOBYPASSRLS`, não é dono de nada, então o RLS sempre se aplica). O `0001` aborta a migration se `openrate_app` não existir ou tiver SUPERUSER/BYPASSRLS.

**Funções SECURITY DEFINER** (donas: `openrate_owner`; EXECUTE só para `openrate_app`): `openrate.auth_find_user(email)` (lookup de login), `openrate.bootstrap_super_admin(...)` (cria o 1º super_admin e se autodesabilita) e `openrate.click_affiliate_link(code)` (resolver público de `/r/:code`).

**Motor de comissão:** regra vencedora por especificidade (pesos `product 16 > category 8 > store 4 > organization 2 > platform 1`, refletidos na coluna GENERATED `priority`), com rateio creator/store/platform que preserva a soma e nunca gera parcela negativa. Lógica pura em `packages/shared/src/commission.ts` (com testes).

---

## API — `apps/api` (NestJS 10)

Guard global `JwtAuthGuard` (`APP_GUARD`): exige `Authorization: Bearer`, valida o JWT HS256, confere `app_metadata.product === 'openrate'` e monta o `TenantContext` (`userId`, `orgId`, `storeId`, `role`, `correlationId`). `@Public()` dispensa auth; `@Roles(...)` exige papel mínimo (`super_admin` sempre passa); `@CurrentTenant()` injeta o contexto. Escritas tenant-scoped chamam `assertOrgContext()` → **400** quando não há org selecionada (em vez de deixar o Postgres 500ar). A API só **enfileira** jobs (BullMQ); o worker consome. Uploads não passam pela API: ela **pré-assina** URLs S3 e o navegador envia direto ao MinIO.

Todas as rotas ficam sob o prefixo **`/v1`**, exceto `/health` e `/r/:code`.

| Grupo | Rotas principais |
|---|---|
| **auth** | `POST /v1/auth/login` · `/refresh` · `/bootstrap` *(públicas)* · `POST /v1/auth/switch-org` (act-as-org) |
| **me** | `GET /v1/me` · `PATCH /v1/me/pix` · `GET /v1/me/earnings` |
| **orgs** *(super_admin)* | `GET/POST /v1/orgs` · `GET/PATCH /v1/orgs/:id` |
| **stores** | `GET /v1/stores` · `GET /v1/stores/:id` · `POST/PATCH` *(owner)* · `GET /v1/stores/:id/users` |
| **users** | `POST /v1/users/invite` *(manager, gera senha temporária)* |
| **products** | `GET /v1/products` · `GET/PATCH /v1/products/:id` · `POST` *(manager)* |
| **catalog** | `GET/POST /v1/brands` · `GET/POST /v1/categories` · `GET /v1/video-types` |
| **ideas** | `POST /v1/products/:id/generate-ideas` *(202)* · `GET /v1/products/:id/ideas` · `POST /v1/ideas/:id/select` |
| **videos** | `POST /v1/videos` (inicia upload) · `POST /v1/videos/:id/complete-upload` *(202)* · `GET /v1/videos` · `GET /v1/videos/:id` · `POST /v1/videos/:id/approve`·`/reject` *(manager)* |
| **goals** | `GET/POST /v1/goals` · `GET /v1/goals/progress` |
| **sales** | `POST /v1/affiliate-sales` · `/import` (CSV) · `GET /v1/affiliate-sales` · `POST /v1/affiliate-sales/:id/cancel` · `GET /v1/commission-entries` |
| **commission-rules** | `GET/POST /v1/commission-rules` · `POST /v1/commission-rules/simulate` |
| **publications** | `POST /v1/videos/:id/publications` · `GET /v1/publications` · `GET /r/:code` *(redirect público)* |
| **settlements** | `POST /v1/settlements/close` *(owner, 202)* |
| **payouts** | `GET /v1/payouts` · `POST /v1/payouts/:id/approve`·`/pay` *(owner)* |
| **dashboard** | `GET /v1/dashboard` *(manager)* |
| **notifications** | `GET /v1/notifications` |
| **webhooks** | `POST /v1/webhooks/asaas` · `/docuseal` *(públicas, autenticadas por token)* |
| **health** | `GET /health` *(pública — checa Postgres + Redis)* |

**super_admin (act-as-org):** um super_admin nasce sem org (`organization_id NULL`). Ele lista/cria orgs e chama `POST /v1/auth/switch-org { orgId }` para **re-emitir o JWT** com aquela org — a partir daí opera como se pertencesse a ela.

---

## Web — `apps/web` (Next.js 14, App Router)

Build `output: 'standalone'`, `transpilePackages: ['@openrate/shared']`. PWA: `manifest.webmanifest` (start_url `/app`, tema `#2e7d32`, ícones 192/512) e `sw.js` que faz cache do shell mas **nunca** intercepta chamadas `/v1` nem uploads ao `bucketss3` (sempre rede). Dois route groups:

**`(panel)` — painel admin (desktop, sidebar):**
`/dashboard`, `/products` + `/products/:id/ideas`, `/videos` (fila de aprovação), `/goals`, `/sales` (importação CSV), `/commissions` (regras + extrato + simulador), `/payouts` (fechar período, aprovar, pagar) e `/orgs` (super_admin: lista/cria org + entrar).

**`(app)` — PWA do atendente (mobile, bottom-nav):**
`/app` (home), `/app/products`, `/app/record/:ideaId` (gravação guiada), `/app/upload` (fila de envios), `/app/my-videos` (publicar + gerar link), `/app/my-commissions`, `/app/goals`, `/app/pix`.

Além de `/` (landing) e `/login`. **`lib/`**: `api.ts` (cliente fetch tipado, tokens em `localStorage`, refresh single-flight no 401, `ApiError` humanizado, `switchOrg`), `auth.tsx` (contexto `useAuth`), `upload.ts` (multipart resumível em chunks de 8 MB), `recording.ts` (`MediaRecorder`), `idb.ts` (fila offline em IndexedDB) e `format.ts` (`Intl` pt-BR: `brl`/`date`/`dateTime`). **`components/`**: `toast.tsx`, `modal.tsx`, `register-sw.tsx`.

---

## Worker — `apps/worker` (BullMQ)

**6 filas**, definidas uma única vez em `packages/shared/src/queues.ts` (fonte da verdade de nomes, `jobId`s determinísticos, payloads tipados, tentativas/backoff e concorrência padrão): `video-processing`, `ai-script-generation`, `metrics-sync`, `commission-settlement`, `payout-pix`, `notifications`. Concorrência ajustável por env; RLS reaplicada por job (o `JobTenant` viaja no payload e o worker refaz o `set_config`). Healthcheck próprio (`healthcheck.ts`: Redis PING + Postgres SELECT 1).

Processadores (`apps/worker/src/processors/`):
- **video-processing** — baixa o bruto do MinIO → `ffprobe` (valida duração/áudio) → transcrição **Whisper** → `ffmpeg` (transcode MP4/H.264 + legenda queimada + marca d'água) → thumbnail → sobe final+thumb → marca `videos` como `ready` → enfileira notificação "vídeo pronto".
- **ai-script-generation** — chama o Claude (`claude-sonnet-5` → fallback `claude-haiku-4-5`), valida a saída com Zod e grava N `video_ideas`.
- **commission-settlement** — consolida as comissões de creator já vencidas (fim da carência) do período `YYYY-MM` em um `payout` por creator (`pending_approval`).
- **notifications** — renderiza por template e envia via **Evolution** (WhatsApp); canais não-WhatsApp marcados como enviados in-app.
- **stubs** — `metrics-sync` (Browserless) e `payout-pix` (Asaas) são placeholders logados para a fase Escala.

---

## Fluxo ponta-a-ponta (golden path)

`bootstrap` do super_admin → cria organização → **entra na org** (`switch-org`) → cria loja → cadastra produto → **gerar ideias** (IA no worker) → *(PWA)* atendente escolhe a ideia, grava e faz **upload direto ao MinIO** → worker processa (legenda + marca d'água) → gestor **aprova** → atendente **publica + gera link de afiliado** → cliques em `/r/:code` são rastreados → gestor **importa vendas** (CSV) → **motor de comissão** gera o rateio → **fechar período** → **payout** → **Pix**.

---

## Desenvolvimento local

Suba só as dependências e rode as apps no host:

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres 15 (semeado por db/dev-init.sql), Redis, MinIO + bucket
cp .env.dev.example .env                          # preencha as variáveis
pnpm install
pnpm dev                                           # turbo — api, web, worker, bullboard em paralelo
```

Verificação: `pnpm ci` (typecheck + build + test). O CI em `.github/workflows/ci.yml` roda exatamente isso em cada push/PR (sem step de deploy — o deploy é manual na VPS).

---

## Deploy

Docker Swarm em nó manager único, atrás do Traefik. **Nenhuma porta publicada** — ingress só pelo Traefik. Detalhes em [`deploy/runbook.md`](deploy/runbook.md) e [`docs/06-primeiro-deploy.md`](docs/06-primeiro-deploy.md).

**Primeiro deploy** (idempotente, só operações aditivas):

```bash
cp deploy/.env.example deploy/.env   # preencha os placeholders
bash deploy/first-up.sh              # roles/schema/migrations → bucket MinIO + policy → build das 4 imagens → docker stack deploy → smoke em /health
```

**Redeploy limpo** (rebuild sem cache, escopo só OpenRate — nunca faz prune global):

```bash
bash redeploy.sh                # preserva o volume do Redis
bash redeploy.sh --wipe-redis   # também zera a fila
```

As imagens `talkhub/openrate-*` são taggeadas com o SHA do git para o Swarm detectar a mudança sem registry (`OPENRATE_IMAGE_TAG`).

**Variáveis de ambiente** (`deploy/.env.example` — só **nomes**, nunca valores no repositório):

| Grupo | Variáveis |
|---|---|
| Banco | `OPENRATE_DB_PASSWORD` (runtime `openrate_app`), `OPENRATE_DB_OWNER_PASSWORD` (migrations `openrate_owner`, só no `first-up.sh`) |
| Redis | `OPENRATE_REDIS_PASSWORD` |
| JWT/Auth | `SUPABASE_JWT_SECRET` |
| S3/MinIO | `S3_ACCESS_KEY`, `S3_SECRET_KEY` (e, só no provisionamento, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) |
| IA | `ANTHROPIC_API_KEY` |
| Pagamentos | `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN` |
| Cessão de imagem | `DOCUSEAL_WEBHOOK_TOKEN` |
| WhatsApp | `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` |
| Bull Board | `BULLBOARD_BASICAUTH` (htpasswd bcrypt `user:hash`) |

> As senhas que entram em URIs (DB/Redis) devem ser URL-safe (`[A-Za-z0-9._-]`) — o `first-up.sh` valida isso.

---

## Documentos

| Documento | O que contém |
|---|---|
| [`openrate-produto-e-stack.md`](openrate-produto-e-stack.md) | Especificação de produto v1.0 e stack tecnológica (fonte original). |
| [`docs/01-analise-critica.md`](docs/01-analise-critica.md) | Análise crítica da spec: o que manter, lacunas/riscos com melhoria concreta, mapa de reaproveitamento da infra e checklist anti-conflito com a produção. |
| [`docs/02-arquitetura.md`](docs/02-arquitetura.md) | Arquitetura de microserviços: serviços novos e reaproveitados, contratos de uso, fluxos críticos, rotas da API e convenções do monorepo. |
| [`docs/03-banco-de-dados.md`](docs/03-banco-de-dados.md) | Modelagem do schema `openrate`: ER por domínio, motor de comissão, RLS de duas vias e regras de convivência no Postgres compartilhado. |
| [`docs/04-sprints.md`](docs/04-sprints.md) | Plano em sprints (Fundação → MVP → Dinheiro → Escala), com DoD, capacidade e riscos. |
| [`docs/05-deploy-e-validacao.md`](docs/05-deploy-e-validacao.md) | Deploy a partir do Git: o que validar e como subir a stack. |
| [`docs/06-primeiro-deploy.md`](docs/06-primeiro-deploy.md) | Passo a passo do **primeiro deploy** na VPS. |
| [`deploy/first-up.sh`](deploy/first-up.sh) | Primeiro up idempotente: banco (migrations) → MinIO → build → `docker stack deploy` → smoke. |
| [`redeploy.sh`](redeploy.sh) | Redeploy limpo sem cache, escopo restrito ao OpenRate. |
| [`deploy/openrate.yaml`](deploy/openrate.yaml) | Stack Docker Swarm (5 serviços) pronta para o Portainer. |
| [`deploy/.env.example`](deploy/.env.example) | Variáveis de ambiente da stack (placeholders — nunca valores reais). |
| [`deploy/runbook.md`](deploy/runbook.md) | Procedimento de deploy: DNS, volume, role/schema/migrations, bucket, build, deploy, smoke, rollback e checklist anti-conflito. |
| [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql) | Schema `openrate` (27 tabelas, 13 enums, RLS com FORCE, view de metas). |
| [`db/migrations/0004_own_auth.sql`](db/migrations/0004_own_auth.sql) | Auth própria da API (scrypt + JWT), `auth_find_user` e `bootstrap_super_admin`. |

Sugestão de leitura: `01` (o porquê) → `02` (a arquitetura) → `03` (o banco) → `04` (o plano) → `deploy/` (como sobe).
