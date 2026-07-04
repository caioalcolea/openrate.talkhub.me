# 02 — Arquitetura de Microserviços

> **⚠️ Estado atual:** documento histórico de projeto. A stack hoje usa **autenticação própria da API** (scrypt + JWT HS256 com `JWT_SECRET`, **sem gotrue**) e trata o Postgres como um **banco compartilhado comum** (container `supabase_db`), sem depender de features do Supabase. Referência atual: [`../README.md`](../README.md). Menções a "Supabase/gotrue" abaixo refletem o desenho original.

> Documento de arquitetura do OpenRate integrado à infraestrutura de produção existente (Docker Swarm, nó único manager, rede overlay externa `talkhub`). Complementa a especificação de produto (`openrate-produto-e-stack.md`). Nenhuma porta é publicada no host: todo tráfego externo entra pelo Traefik (80/443) e todo tráfego interno usa DNS de serviço na rede `talkhub`.

---

## 1. Visão geral

A stack `openrate` adiciona **5 serviços novos** ao Swarm e **reusa 8 serviços já em produção**. O princípio: só criamos o que não existe (API, worker de mídia, painel, Redis dedicado para filas, Bull Board). Banco, auth, storage de objetos, WhatsApp, browser headless, assinatura de documentos, suporte e resize de imagem são reaproveitados com contratos de uso estritos (seção 3).

Pontos estruturais:

- **Produto 100% web.** O atendente usa o **PWA** (mesma aplicação Next.js do painel, `openrate_web`), aberto no navegador do celular e instalável via "Adicionar à tela inicial" — sem publicação em loja de aplicativos. Câmera e gravação usam `getUserMedia`/`MediaRecorder`; fila offline e notificações via service worker + Web Push.
- **Upload de vídeo nunca passa pela API.** O navegador (PWA do atendente) pede URLs presigned multipart à `openrate_api` e envia as partes direto para o MinIO via `https://bucketss3.talkhub.me` (roteado pelo Traefik). A API só orquestra metadados e enfileira o processamento.
- **Todo trabalho pesado é assíncrono** via BullMQ no `openrate_redis` (dedicado, `noeviction` — o `redis_redis` compartilhado do servidor não serve para BullMQ por não garantir `noeviction`).
- **Multi-tenancy em duas camadas**: autorização na API (claims do JWT) + RLS no Postgres como defesa em profundidade, funcionando mesmo em conexão direta (seção 7).

### 1.1 Diagrama geral

```mermaid
graph TB
    subgraph CLIENTES["Clientes (100% web)"]
        MOBILE["PWA atendente/creator<br/>navegador do celular"]
        BROWSER["Painel<br/>owner/manager/admin"]
    end

    subgraph EDGE["Borda — REUSADO"]
        TRAEFIK["Traefik v3.4<br/>80/443, TLS Let's Encrypt"]
    end

    subgraph OPENRATE["Stack openrate — NOVO"]
        WEB["openrate_web<br/>Next.js :3000<br/>openrate.talkhub.me"]
        API["openrate_api<br/>NestJS :3000<br/>openrate-api.talkhub.me"]
        REDIS["openrate_redis<br/>redis:7-alpine :6379<br/>noeviction"]
        WORKER["openrate_worker<br/>BullMQ + FFmpeg + faster-whisper"]
        BULLBOARD["openrate_bullboard :3000<br/>openrate-queues.talkhub.me<br/>(basicauth Traefik)"]
    end

    subgraph REUSO["Serviços existentes — REUSADOS"]
        AUTH["supabase_auth (gotrue)<br/>JWT + Admin API"]
        DB[("supabase_db<br/>Postgres 15.8<br/>schema openrate")]
        MINIO[("minio_minio :9000<br/>bucket openrate-media<br/>raw/ final/ thumbs/")]
        EVO["evolution_evolution_api :8080<br/>WhatsApp"]
        BROWSERLESS["browserless_browserless :3000<br/>Chrome headless"]
        IMGPROXY["supabase_imgproxy :8080<br/>resize de imagens"]
        DOCUSEAL["docuseal<br/>termo de cessão de imagem"]
        CHATWOOT["chatwoot<br/>widget de suporte"]
    end

    subgraph EXTERNO["APIs externas"]
        CLAUDE["API Claude<br/>claude-sonnet-5 /<br/>claude-haiku-4-5"]
        ASAAS["Asaas<br/>transferência Pix"]
        PLATAFORMAS["Plataformas de afiliados<br/>TikTok, Shopee, ML..."]
    end

    MOBILE -->|"HTTPS API REST"| TRAEFIK
    MOBILE -->|"upload presigned multipart<br/>bucketss3.talkhub.me"| TRAEFIK
    BROWSER --> TRAEFIK

    TRAEFIK --> WEB
    TRAEFIK --> API
    TRAEFIK --> BULLBOARD
    TRAEFIK -->|"presigned PUT direto"| MINIO

    WEB -->|"REST server-side e client-side"| API
    API -->|"valida JWT (secret) +<br/>Admin API (app_metadata)"| AUTH
    API -->|"SQL, schema openrate<br/>role openrate_app"| DB
    API -->|"enfileira jobs BullMQ"| REDIS
    API -->|"gera presigned URLs"| MINIO
    API -.->|"URLs de resize"| IMGPROXY
    API -.->|"envio de termo"| DOCUSEAL

    WORKER -->|"consome filas"| REDIS
    WORKER -->|"baixa raw/ e sobe final/, thumbs/"| MINIO
    WORKER -->|"geração de ideias/roteiros"| CLAUDE
    WORKER -->|"notificações WhatsApp"| EVO
    WORKER -->|"scraping de métricas"| BROWSERLESS
    WORKER -->|"payout Pix"| ASAAS
    WORKER -->|"SQL, schema openrate"| DB
    WORKER -.->|"import de vendas / APIs"| PLATAFORMAS

    BULLBOARD -->|"leitura das filas"| REDIS
    BROWSER -.->|"widget client-side"| CHATWOOT

    classDef novo fill:#dcefdc,stroke:#2e7d32,stroke-width:2px,color:#1b3a1b;
    classDef reusado fill:#e3e8f0,stroke:#455a80,stroke-width:1.5px,stroke-dasharray:4 3,color:#1e2a40;
    classDef externo fill:#fdf3dc,stroke:#a07d1c,stroke-width:1.5px,stroke-dasharray:2 2,color:#4a3a0c;
    class WEB,API,REDIS,WORKER,BULLBOARD novo;
    class TRAEFIK,AUTH,DB,MINIO,EVO,BROWSERLESS,IMGPROXY,DOCUSEAL,CHATWOOT reusado;
    class CLAUDE,ASAAS,PLATAFORMAS externo;
```

**Legenda**: verde sólido = serviço novo (stack `openrate`); azul tracejado = serviço já em produção, reusado; amarelo pontilhado = API externa (fora do Swarm). Produto 100% web: tanto o atendente (PWA) quanto o painel são servidos pelo `openrate_web` — um único front Next.js com rotas por role.

### 1.2 Hosts públicos (routers Traefik)

| Host | Serviço | Proteção |
|---|---|---|
| `openrate.talkhub.me` | `openrate_web` | JWT na aplicação |
| `openrate-api.talkhub.me` | `openrate_api` | JWT (Bearer) validado pela API |
| `openrate-queues.talkhub.me` | `openrate_bullboard` | middleware `basicauth` do Traefik |
| `bucketss3.talkhub.me` | MinIO (já existente) | presigned URLs assinadas (expiração curta) |

---

## 2. Catálogo de serviços da stack `openrate`

Todos com `deploy.mode=replicated`, `replicas: 1`, constraint `node.role == manager`, rede `talkhub` (external), healthcheck e limites de recursos. Labels do Traefik dentro de `deploy.labels`, padrão Orion. Nenhum `ports:` publicado.

### 2.1 `openrate_api`

| Item | Valor |
|---|---|
| Responsabilidade | API REST (NestJS): autenticação/tenancy, CRUD de catálogo/conteúdo/financeiro/engajamento, geração de presigned URLs, enfileiramento de jobs, webhooks (Asaas, Docuseal), regras de negócio síncronas |
| Imagem | `talkhub/openrate-api:latest` (build local) |
| Porta interna | 3000 |
| Recursos | 1 CPU / 1 GB |
| Dependências | `supabase_db:5432` (role `openrate_app`, `search_path=openrate`), `supabase_auth` (validação de JWT via `SUPABASE_JWT_SECRET` + Admin API), `openrate_redis:6379` (produtor BullMQ), `minio_minio:9000` (SDK S3 para presigned), `docuseal` (envio de termo) |
| Healthcheck | `GET /health` (checa DB + Redis) |
| O que NÃO faz | Não processa vídeo, não transcreve, não chama a API Claude, não faz scraping, não dispara Pix, não envia WhatsApp (tudo isso é do worker via fila). Não recebe bytes de vídeo — upload é direto ao MinIO. Não serve páginas HTML. |

### 2.2 `openrate_worker`

| Item | Valor |
|---|---|
| Responsabilidade | Consumidor BullMQ das 6 filas: `video-processing` (ffprobe → faster-whisper → FFmpeg corte/legenda queimada/watermark/thumbnail), `ai-script-generation` (Claude), `metrics-sync` (APIs de plataforma + Browserless), `commission-settlement` (fechamento), `payout-pix` (Asaas), `notifications` (Evolution API) |
| Imagem | `talkhub/openrate-worker:latest` (Node + FFmpeg + faster-whisper CPU, modelo `small`, empacotados na imagem) |
| Porta interna | nenhuma exposta (sem router Traefik) |
| Recursos | 2 CPU / 3 GB (FFmpeg + whisper são os maiores consumidores da stack) |
| Dependências | `openrate_redis:6379` (consumidor), `supabase_db:5432`, `minio_minio:9000`, API Claude (saída HTTPS), `evolution_evolution_api:8080`, `browserless_browserless:3000`, API Asaas (saída HTTPS) |
| Healthcheck | script CMD interno (verifica conexão Redis e loop de eventos vivo) — sem porta HTTP |
| O que NÃO faz | Não expõe endpoint HTTP, não valida JWT de usuário (recebe contexto de tenant no payload do job), não escreve fora do schema `openrate` nem fora do bucket `openrate-media`, não decide regra de negócio de comissão fora do que está persistido em `commission_rules` |

Concorrência por fila (mesmo processo, `Worker` BullMQ por fila): `video-processing: 1` (CPU-bound), `ai-script-generation: 2`, `metrics-sync: 2`, `notifications: 5`, `commission-settlement: 1`, `payout-pix: 1`.

### 2.3 `openrate_web`

| Item | Valor |
|---|---|
| Responsabilidade | Front Next.js (Tailwind + shadcn/ui) **único para todos os papéis**: (a) painel owner/manager/super_admin (dashboards, aprovação de vídeos, catálogo, metas, financeiro, regras de comissão); (b) **PWA do atendente** — lista de ideias, gravação com overlay-guia via `getUserMedia`/`MediaRecorder`, upload resumível, "minhas comissões". Manifest + service worker (instalável, fila offline, Web Push). Carrega o widget do Chatwoot (client-side) |
| Imagem | `talkhub/openrate-web:latest` (build local, output standalone) |
| Porta interna | 3000 |
| Recursos | 0.5 CPU / 512 MB |
| Dependências | `openrate_api` (única fonte de dados — o web NÃO acessa o banco), `supabase_auth` indireto (login via API) |
| Healthcheck | `GET /api/health` |
| O que NÃO faz | Não acessa Postgres, Redis ou MinIO diretamente; não contém regra de negócio; não recebe bytes de vídeo (upload é presigned direto ao MinIO); não guarda segredos de integração (só `NEXT_PUBLIC_*` + URL da API) |

### 2.4 `openrate_redis`

| Item | Valor |
|---|---|
| Responsabilidade | Redis dedicado exclusivamente ao BullMQ do OpenRate |
| Imagem | `redis:7-alpine`, comando com `--appendonly yes --maxmemory-policy noeviction` |
| Porta interna | 6379 (só na overlay `talkhub`; sem router Traefik) |
| Recursos | 0.5 CPU / 512 MB |
| Volume | externo `openrate_redis_data` (pré-criado) |
| Dependências | nenhuma |
| Healthcheck | `redis-cli ping` |
| O que NÃO faz | Não é cache de aplicação, não é sessão, não é pub/sub genérico. Nenhum outro produto do servidor pode usá-lo. O `redis_redis` compartilhado segue intocado. |

### 2.5 `openrate_bullboard`

| Item | Valor |
|---|---|
| Responsabilidade | UI do Bull Board para observar/reprocessar jobs (falhas, travados, DLQ manual) |
| Imagem | `talkhub/openrate-bullboard:latest` (Express + `@bull-board/express`) |
| Porta interna | 3000 |
| Recursos | 0.25 CPU / 256 MB |
| Dependências | `openrate_redis:6379` (somente leitura/retry das filas) |
| Proteção | middleware `basicauth` do Traefik declarado em `deploy.labels` (usuário/hash htpasswd) — a aplicação em si não implementa auth |
| Healthcheck | `GET /` |
| O que NÃO faz | Não cria jobs de negócio, não acessa banco, não é exposto sem basicauth |

---

## 3. Serviços existentes reaproveitados (contratos de uso)

Regra geral: o OpenRate é **inquilino** desses serviços. Qualquer alteração de configuração global (env, versão, políticas) desses containers está fora do escopo da stack `openrate` — se um contrato exigir mudança global, ela vira decisão de infraestrutura separada.

### 3.1 `supabase_db` (Postgres 15.8)

- **DNS/porta**: `supabase_db:5432` (conexão direta; `supabase_supavisor` fica como opção futura se houver pressão de conexões).
- **Credencial**: duas roles — `openrate_owner` (migração, **dona** do schema `openrate`) e `openrate_app` (runtime, **não-dona**, `NOSUPERUSER NOBYPASSRLS`, sem `USAGE` em outros schemas). A app conecta como `openrate_app`; o `search_path` já vem fixado no nível da role (`ALTER ROLE ... SET search_path = openrate`), então a DSN não precisa do parâmetro: `postgresql://openrate_app:***@supabase_db:5432/postgres`. A separação owner/app é o que faz `FORCE ROW LEVEL SECURITY` valer para a role de runtime (dono ignora RLS a menos que forçado; a app, por não ser dona, não pode nem desabilitar o RLS via `ALTER TABLE`).
- **Uso**: schema `openrate` com migrations versionadas via **dbmate** (SQL puro — necessário para declarar policies RLS, triggers e views sem abstração de ORM). Tabelas conforme modelagem da spec (multi-tenancy, catálogo, conteúdo, financeiro, engajamento, CRM físico, operação).
- **Cuidados**: (1) pool de conexões limitado — API máx. 10, worker máx. 5 — para não esgotar `max_connections` compartilhado com gotrue/postgrest/storage; (2) nenhum objeto criado fora do schema `openrate`; (3) não instalar extensões novas sem alinhamento (usar `pgcrypto` já disponível na imagem Supabase para criptografar `integrations.credentials`); (4) migrations nunca tocam os schemas `auth`, `storage`, `public` do Supabase.

### 3.2 `supabase_auth` (gotrue v2.176)

- **DNS/porta**: `supabase_auth:9999` (porta padrão do GoTrue na stack Supabase; confirmar no compose da stack antes do primeiro deploy).
- **Credenciais**: `SUPABASE_JWT_SECRET` (validação HS256 local na API, sem round-trip) e `service_role` key para a **Admin API** (`/admin/users`) — usada para criar/convidar usuários e gravar `app_metadata: { product: "openrate", org_id, store_id, role }`.
- **Uso**: login/refresh do app e do painel via gotrue; a `openrate_api` nunca emite token próprio.
- **Cuidados**: (1) `auth.users` é compartilhado com outros produtos — todo usuário OpenRate carrega `app_metadata.product = "openrate"` e a API rejeita tokens sem essa marca; (2) não alterar SMTP, templates de e-mail ou configurações globais do gotrue; (3) `app_metadata` só é gravado via Admin API pela `openrate_api` (nunca `user_metadata`, que é editável pelo próprio usuário).

### 3.3 MinIO

- **DNS/porta**: interno `minio_minio:9000` (SDK da API/worker); público `https://bucketss3.talkhub.me` (endpoint usado nas presigned URLs do app). Região da assinatura: `eu-south` (obrigatório coincidir com `MINIO_REGION_NAME`).
- **Credencial**: usuário MinIO dedicado `openrate-app` com policy restrita ao bucket `openrate-media` (jamais usar o root `Admin` na aplicação).
- **Uso**: bucket `openrate-media` com prefixos `raw/` (upload bruto multipart), `final/` (vídeo editado), `thumbs/`. Lifecycle rule: expirar `raw/` após 30 dias. Uploads via presigned multipart gerados pela API com o endpoint público; leitura via presigned GET de curta duração.
- **Cuidados**: (1) lifecycle e policies aplicadas somente ao bucket `openrate-media` — outros buckets do servidor intocados; (2) presigned URLs assinadas contra `bucketss3.talkhub.me` (host público), senão a assinatura quebra ao passar pelo Traefik; (3) abortar multipart incompleto (regra de cleanup) para não acumular partes órfãs.

### 3.4 Evolution API (v2.3.7)

- **DNS/porta**: `evolution_evolution_api:8080`.
- **Credencial**: `apikey` global (header) + **instância WhatsApp dedicada** `openrate` (criada via `POST /instance/create`), com número próprio do produto.
- **Uso**: fila `notifications` do worker envia mensagens transacionais ao atendente: meta batida, comissão creditada, vídeo aprovado/pronto. Endpoints `POST /message/sendText/openrate` (e mídia quando fizer sentido).
- **Cuidados**: (1) nunca enviar por instâncias de outros produtos; (2) throttling na fila (concorrência 5 + rate limiter BullMQ) para reduzir risco de bloqueio do número; (3) mensagens apenas transacionais e com opt-out registrado em `notifications` — nada de broadcast/marketing.

### 3.5 Browserless

- **DNS/porta**: `browserless_browserless:3000` (WebSocket CDP `ws://browserless_browserless:3000` + REST `/content`, `/screenshot`).
- **Credencial**: token do Browserless se configurado na stack (`?token=`).
- **Uso**: fallback da fila `metrics-sync` para plataformas sem API pública (ex.: contagem de views de vídeo em página pública). Sessões efêmeras, uma página por job.
- **Cuidados**: serviço compartilhado — concorrência máxima 2 no lado do OpenRate, timeout de sessão ≤ 60 s, sempre fechar a sessão no `finally`. Se um scraper vazar sessões, degrada outros produtos do servidor.

### 3.6 Docuseal

- **DNS/porta**: serviço da stack `docuseal` na overlay (porta interna 3000, padrão da imagem `docuseal/docuseal`; confirmar o nome DNS `docuseal_docuseal` no compose da stack).
- **Credencial**: API token (`X-Auth-Token`) de um usuário/espaço dedicado ao OpenRate.
- **Uso**: no onboarding do atendente, a API cria uma submission a partir do template "Termo de cessão de imagem" e envia o link de assinatura; webhook de conclusão marca `users.image_release_signed_at`. Atendente sem termo assinado não tem vídeos publicáveis.
- **Cuidados**: template e webhooks em espaço próprio; não alterar templates de outros produtos; guardar o PDF assinado (cópia) no MinIO em `openrate-media` para independência do Docuseal.

### 3.7 Chatwoot

- **Contrato**: widget **client-side** no `openrate_web`, carregado da URL pública do Chatwoot com `website_token` de uma **inbox dedicada "OpenRate"**. Sem chamada server-side.
- **Cuidados**: criar inbox própria (não reutilizar inboxes de outros produtos); identificar o usuário no widget com `setUser` (HMAC de identidade se habilitado) para o suporte ver org/loja.

### 3.8 imgproxy (v3.8)

- **DNS/porta**: `supabase_imgproxy:8080`.
- **Uso**: resize/crop on-the-fly de imagens de produto (`product_images`) armazenadas no MinIO — a `openrate_api` gera URLs assinadas do imgproxy apontando para a origem S3 e o painel/app consomem via rota interna.
- **Cuidados**: o imgproxy pertence à stack Supabase (usado pelo storage-api) — **modo somente-consumo**: usar as chaves de assinatura existentes sem alterar nenhuma env do container; se o volume de tráfego do OpenRate crescer a ponto de disputar recurso, sobe-se um imgproxy próprio na stack `openrate` (decisão futura, não agora). Não usar imgproxy para vídeo (thumbnails de vídeo são geradas pelo FFmpeg no worker).

---

## 4. Fluxos críticos

### 4.1 Upload e processamento de vídeo

```mermaid
sequenceDiagram
    autonumber
    participant App as PWA (navegador)
    participant TR as Traefik
    participant API as openrate_api
    participant S3 as MinIO (openrate-media)
    participant Q as openrate_redis (BullMQ)
    participant W as openrate_worker
    participant DB as supabase_db (schema openrate)
    participant EVO as Evolution API

    App->>TR: POST /videos (idea_id, duração, metadados)
    TR->>API: proxy
    API->>DB: INSERT videos (status=uploading)
    API->>S3: CreateMultipartUpload + presign das partes (endpoint bucketss3.talkhub.me)
    API-->>App: video_id + uploadId + URLs presigned por parte

    loop cada parte (5-16 MB)
        App->>TR: PUT parte (presigned)
        TR->>S3: proxy direto (bytes NÃO passam pela API)
        S3-->>App: ETag
    end
    App->>TR: POST /videos/:id/complete-upload (lista de ETags)
    TR->>API: proxy
    API->>S3: CompleteMultipartUpload + HEAD raw/{video_id}.mp4 (valida existência/tamanho)
    API->>DB: UPDATE videos SET status=processing
    API->>Q: add job video-processing (jobId=video-processing:{video_id})
    API-->>App: 202 Accepted

    Q-->>W: job video-processing
    W->>S3: GET raw/{video_id}.mp4
    W->>W: ffprobe (duração/áudio) → faster-whisper small (transcrição → legenda)
    W->>W: FFmpeg: corte, legenda queimada, watermark da loja, thumbnail
    W->>S3: PUT final/{video_id}.mp4 + thumbs/{video_id}.jpg
    W->>DB: UPDATE videos SET status=ready, transcript, duração final
    W->>Q: add job notifications (jobId=notifications:video-ready:{video_id})
    Q-->>W: job notifications
    W->>EVO: POST /message/sendText/openrate ("seu vídeo está pronto")
    EVO-->>App: WhatsApp do atendente
```

Falhas: se o job `video-processing` estourar as tentativas (seção 7.4), o worker marca `videos.status=failed` com `failure_reason`, e o job fica visível no Bull Board para reprocesso manual. `raw/` expira em 30 dias por lifecycle, então reprocesso após esse prazo exige novo upload.

### 4.2 Geração de ideias por IA

```mermaid
sequenceDiagram
    autonumber
    participant Web as Painel (manager)
    participant API as openrate_api
    participant DB as supabase_db (schema openrate)
    participant Q as openrate_redis (BullMQ)
    participant W as openrate_worker
    participant CL as API Claude

    Web->>API: POST /products (dados do produto)
    API->>DB: INSERT products
    API->>Q: add job ai-script-generation (jobId=ai-script:{product_id}:{video_type_id})
    API-->>Web: 201 (product) — geração roda em background

    Q-->>W: job ai-script-generation
    W->>DB: SELECT produto + categoria + video_type (prompt context)
    W->>CL: messages API — claude-sonnet-5, saída JSON estruturada (40 ideias: hook, roteiro passo a passo, legenda, hashtags, duração alvo)
    alt erro 429/5xx persistente ou modo econômico do tenant
        W->>CL: fallback claude-haiku-4-5 (mesmo prompt)
    end
    CL-->>W: JSON com 40 ideias
    W->>W: validação zod (schema compartilhado em packages/shared)
    W->>DB: INSERT 40 video_ideas (status=draft) em transação única
    W->>DB: UPDATE products SET ideas_generated_at=now()
    W-->>Web: (polling GET /products/:id/ideas ou refresh do painel)
```

Observações: a spec v1.0 cita "claude-sonnet-4-6"; o modelo correto adotado é **`claude-sonnet-5`** com **`claude-haiku-4-5`** como fallback econômico. Resposta fora do schema zod conta como falha do job (retry com backoff); nunca persistir JSON parcial.

### 4.3 Venda de afiliado → comissão → payout Pix

Sem diagrama (fluxo batch, três estágios desacoplados por filas):

1. **Ingestão da venda**: `metrics-sync`/importadores gravam `affiliate_sales` (via API da plataforma quando existe, senão import CSV manual pelo painel ou scraping Browserless). Cada venda referencia o `affiliate_link` → vídeo → creator → loja → org. Dedup por `(platform, external_order_id)` com constraint UNIQUE — reimportar é idempotente.
2. **Motor de comissão** (síncrono na ingestão de cada venda confirmada): resolve a regra aplicável em `commission_rules` pela precedência **mais específica vence** — produto > categoria > loja > organização > plataforma (global). Gera `commission_entries` (lançamentos para creator, loja e plataforma OpenRate) com status `pending`. Venda cancelada/estornada gera lançamentos de estorno espelhados (nunca UPDATE/DELETE do lançamento original — razão contábil append-only).
3. **Fechamento** (`commission-settlement`, cron quinzenal/mensal por org, `jobId=commission-settlement:{org_id}:{period}`): consolida `commission_entries` pendentes do período em `payouts` (um por favorecido), status `awaiting_approval`. Owner aprova no painel (`POST /payouts/:id/approve`).
4. **Pagamento** (`payout-pix`, `jobId=payout-pix:{payout_id}`): worker chama a API do Asaas (transfer para chave Pix do atendente) enviando **chave de idempotência = payout_id**. Sucesso → `payouts.status=paid` + comprovante; falha → `failed`, sem retry automático (dinheiro: reprocesso só manual via Bull Board após conferência). Webhook do Asaas confirma liquidação assíncrona quando aplicável. Stripe foi descartado: não atende payout Pix para terceiros no Brasil.

---

## 5. Contratos de API principais (`openrate_api`)

Prefixo `/v1`, JSON, autenticação Bearer JWT (exceto webhooks, autenticados por segredo próprio). Resumo por domínio — o contrato completo (OpenAPI) vive em `apps/api` e os schemas zod em `packages/shared`.

| Domínio | Rota | Método | Descrição / roles |
|---|---|---|---|
| Auth/Tenancy | `/auth/login`, `/auth/refresh` | POST | Proxy fino para gotrue (padroniza erros) |
| Auth/Tenancy | `/me` | GET | Perfil + claims resolvidos (org, loja, role) |
| Auth/Tenancy | `/orgs` · `/orgs/:id` | GET/POST/PATCH | super_admin; cria org e owner inicial |
| Auth/Tenancy | `/stores` · `/stores/:id` | GET/POST/PATCH | owner/manager |
| Auth/Tenancy | `/stores/:id/users` · `/users/:id/invite` | GET/POST | Convite via gotrue Admin API (seta `app_metadata`); dispara termo Docuseal p/ attendant |
| Catálogo | `/products` · `/products/:id` | GET/POST/PATCH | Escopo `store`/`organization`/`platform`; origem `manual`/`integration`/`platform` |
| Catálogo | `/products/:id/images` | POST/DELETE | Presigned p/ MinIO; URLs de exibição via imgproxy |
| Catálogo | `/products/:id/generate-ideas` | POST | Enfileira `ai-script-generation` (202) |
| Catálogo | `/brands` · `/categories` · `/stores/:id/inventory` | GET/POST/PATCH | Gestão de apoio; inventário sincronizável via Olist (fase 3) |
| Conteúdo | `/video-types` | GET | Tipos de vídeo (unboxing, review, tutorial...) |
| Conteúdo | `/products/:id/ideas` · `/ideas/:id/select` | GET/POST | Atendente escolhe ideia → app monta overlay-guia |
| Conteúdo | `/videos` | POST | Inicia upload: cria registro + presigned multipart |
| Conteúdo | `/videos/:id/complete-upload` | POST | Confirma ETags → HEAD no MinIO → enfileira `video-processing` |
| Conteúdo | `/videos/:id` · `/videos` | GET | Status do pipeline + presigned GET de `final/`/`thumbs/` |
| Conteúdo | `/videos/:id/approve` · `/videos/:id/reject` | POST | manager; aprovação libera publicação |
| Conteúdo | `/videos/:id/publications` · `/publications/:id` | POST/GET/PATCH | Registro de publicação por plataforma (adapter plugável) |
| Conteúdo | `/publications/:id/affiliate-link` | POST | Gera/associa link de afiliado rastreável |
| Financeiro | `/commission-rules` · `/commission-rules/:id` | GET/POST/PATCH | Precedência: produto > categoria > loja > org > plataforma |
| Financeiro | `/affiliate-sales` · `/affiliate-sales/import` | GET/POST | Import CSV/webhook; dedup por `(platform, external_order_id)` |
| Financeiro | `/commission-entries` | GET | Razão append-only, filtros por período/favorecido |
| Financeiro | `/settlements/close` | POST | owner/super_admin; enfileira `commission-settlement` |
| Financeiro | `/payouts` · `/payouts/:id/approve` | GET/POST | Aprovação → enfileira `payout-pix` |
| Financeiro | `/webhooks/asaas` | POST | Confirmação de transferência (assinatura do webhook) |
| Engajamento | `/goals` · `/goals/:id` · `/goals/progress` | GET/POST/PATCH | Metas diárias/semanais (`v_goal_progress_daily`) |
| Engajamento | `/rankings` | GET | Ranking de creators por loja/org/período |
| Engajamento | `/achievements` · `/notifications` | GET | Gamificação e central de notificações |
| Operação | `/webhooks/docuseal` | POST | Termo assinado → libera publicação do atendente |
| Operação | `/health` | GET | Healthcheck (DB + Redis) — sem auth |

---

## 6. Estrutura do monorepo

Repositório único (`openrate.talkhub.me`), pnpm workspaces + Turborepo:

```
openrate.talkhub.me/
├── apps/
│   ├── api/            # NestJS — REST, guards JWT, produtores BullMQ
│   ├── worker/         # Consumidores BullMQ, pipelines FFmpeg/whisper, integrações
│   ├── web/            # Next.js — painel + PWA do atendente (Tailwind + shadcn/ui,
│   │                   # manifest, service worker, rotas por role)
│   └── bullboard/      # Express + @bull-board (imagem mínima)
├── packages/
│   └── shared/         # Tipos TS + schemas zod (contratos API/jobs), enums de roles,
│                       # nomes/jobIds das filas, cliente HTTP tipado
├── db/
│   └── migrations/     # dbmate — SQL puro: schema openrate, RLS, triggers, seeds
├── deploy/
│   ├── openrate.yaml   # Stack Swarm padrão Orion (deploy via Portainer)
│   ├── .env.example
│   └── runbook.md
└── docs/               # 01-produto, 02-arquitetura (este), ...

Cada app tem seu próprio `Dockerfile` na raiz da app (`apps/api/Dockerfile`,
`apps/worker/Dockerfile`, `apps/web/Dockerfile`, `apps/bullboard/Dockerfile`) —
o build roda do contexto do monorepo para compartilhar `packages/shared`.
```

**Por que monorepo único**: time pequeno; o contrato entre API, worker e web é o mesmo conjunto de tipos/schemas zod (`packages/shared`) — uma mudança de payload de job ou de rota é um único PR atômico que atualiza produtor, consumidor e cliente juntos, sem versionamento de pacotes internos nem drift de contrato. CI única constrói as 4 imagens `talkhub/*:latest` (api, worker, web, bullboard) a partir do mesmo commit; o custo clássico de monorepo (build lento, ownership dividido) não existe nessa escala. Como o produto é 100% web, atendente e painel são o **mesmo** `apps/web` (Next.js) — uma base só de front, sem toolchain ou pipeline de build à parte.

---

## 7. Convenções transversais

### 7.1 Autenticação JWT

- Toda rota (exceto `/health` e `/webhooks/*`) exige `Authorization: Bearer <jwt>` emitido pelo gotrue; validação **local** HS256 com `SUPABASE_JWT_SECRET` (sem round-trip por request).
- Claims obrigatórios: `sub` (user id) e `app_metadata` com `product="openrate"`, `org_id`, `role` e, para manager/attendant, `store_id`. Token sem `product="openrate"` é rejeitado (o gotrue é compartilhado com outros produtos).
- `app_metadata` só muda via Admin API chamada pela `openrate_api` (role `service_role`) — nunca pelo cliente.
- Webhooks (Asaas, Docuseal): validação por assinatura/segredo dedicado por integração, nunca por JWT de usuário.

### 7.2 Propagação de tenant

- **HTTP**: guard NestJS extrai claims → contexto de request via AsyncLocalStorage → toda query roda em transação que executa `set_config('request.jwt.claims', '<claims JSON>', true)` antes do SQL. Assim as policies RLS (`organization_id = auth.jwt() ->> 'org_id'`) funcionam mesmo em conexão direta pela role `openrate_app`, como defesa em profundidade além dos filtros explícitos da camada de serviço.
- **Jobs**: todo payload BullMQ carrega `{ orgId, storeId?, userId?, correlationId }`. O worker abre transação e faz o mesmo `set_config` com claims sintéticos do tenant do job — um job jamais processa dados de outra org por engano, mesmo com bug na query.
- Exceção de RLS: `products WHERE scope='platform'` tem leitura liberada a qualquer autenticado (catálogo global), conforme spec.

### 7.3 Idempotência nos jobs (jobId determinístico)

Todo `queue.add` usa `jobId` derivado da entidade — o BullMQ descarta duplicatas enquanto o job existir:

| Fila | jobId | Idempotência adicional no efeito |
|---|---|---|
| `video-processing` | `video-processing:{video_id}` | `final/{video_id}.mp4` é sobrescrito (PUT idempotente); UPDATE de status é absoluto |
| `ai-script-generation` | `ai-script:{product_id}:{video_type_id}` | INSERT das 40 ideias em transação única; regeração explícita usa sufixo `:regen-{n}` |
| `metrics-sync` | `metrics-sync:{publication_id}:{janela ISO}` | UPSERT de métricas por `(publication_id, captured_at)` |
| `commission-settlement` | `commission-settlement:{org_id}:{period}` | UNIQUE `(org_id, period)` em settlements; reexecução é no-op |
| `payout-pix` | `payout-pix:{payout_id}` | Chave de idempotência enviada ao Asaas = `payout_id`; transição de status com guarda (`WHERE status='approved'`) |
| `notifications` | `notifications:{evento}:{entity_id}` | Registro em `notifications` com UNIQUE no par evento/entidade |

Regra: idempotência **nunca** depende só do jobId (jobs concluídos são removidos por `removeOnComplete`) — o efeito no banco/serviço externo tem a sua própria guarda (UNIQUE, UPSERT, idempotency key).

### 7.4 Retries e backoff

Config por fila (BullMQ `defaultJobOptions`):

| Fila | attempts | backoff | Observação |
|---|---|---|---|
| `video-processing` | 3 | exponencial, base 30 s | Falha final → `videos.status=failed` + notificação ao manager |
| `ai-script-generation` | 4 | exponencial, base 15 s | 429/529 da API Claude respeitam `retry-after`; fallback haiku antes da última tentativa |
| `metrics-sync` | 3 | exponencial, base 60 s | Scraping instável é esperado; falha final só loga |
| `commission-settlement` | 2 | fixo 5 min | Reexecução idempotente |
| `payout-pix` | 1 | — | **Sem retry automático** (financeiro); reprocesso manual via Bull Board |
| `notifications` | 5 | exponencial, base 10 s | Rate limiter da fila protege o número WhatsApp |

`removeOnComplete: { count: 500 }`, `removeOnFail: false` (falhas ficam retidas para triagem no Bull Board — é a DLQ operacional).

### 7.5 Correlation id e logs

- Traefik/API: toda request recebe/propaga `x-request-id` (gerado na API se ausente); ele vira `correlationId` no contexto AsyncLocalStorage.
- Todo `queue.add` copia o `correlationId` para o payload do job; jobs agendados por cron geram o seu próprio (`cron:{fila}:{timestamp}`).
- Logs estruturados (pino, JSON em stdout → `docker service logs`): campos mínimos `{ level, time, service, correlationId, orgId, userId?, queue?, jobId?, msg }`. Um upload de vídeo é rastreável de ponta a ponta (request HTTP → job → FFmpeg → notificação) por um único `correlationId`.
- Erros de integração externa logam o corpo da resposta truncado e **nunca** credenciais/URLs presigned completas.

---

*Documentos relacionados: [`03-banco-de-dados.md`](03-banco-de-dados.md) (modelagem + DDL + RLS), [`04-sprints.md`](04-sprints.md) (plano de execução), [`../deploy/openrate.yaml`](../deploy/openrate.yaml) e [`../deploy/runbook.md`](../deploy/runbook.md) (stack padrão Orion + deploy via Portainer).*
