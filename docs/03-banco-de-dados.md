# 03 — Banco de Dados OpenRate

> **⚠️ Estado atual:** documento histórico de projeto. A stack hoje usa **autenticação própria da API** (scrypt + JWT HS256 com `JWT_SECRET`, **sem gotrue**) e trata o Postgres como um **banco compartilhado comum** (container `supabase_db`), sem depender de features do Supabase. Referência atual: [`../README.md`](../README.md). Menções a "Supabase/gotrue" abaixo refletem o desenho original.

> Modelagem do schema `openrate` no Postgres 15.8 compartilhado (`supabase_db`).
> DDL executável: [`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql) — validado de ponta a ponta (migration + RLS de duas vias + view + triggers) num Postgres limpo antes de entrar no repositório.

---

## 1. Visão geral

- **27 tabelas + 1 view** (`v_goal_progress_daily`), tudo dentro do schema `openrate`. Nenhum objeto em `public`, `auth`, `storage` ou schemas de outros produtos.
- **13 ENUMs** nativos (os 12 pedidos pela spec + `commission_beneficiary`, auxiliar do financeiro).
- **IDs**: `uuid` com `gen_random_uuid()` (nativo do Postgres ≥ 13); `audit_log` usa `bigint identity` (append-only, ordenação barata).
- **Dinheiro**: `NUMERIC(14,2)`. **Percentuais**: `NUMERIC(5,2)`. Jamais `float`.
- **Timestamps**: `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` em todas as tabelas, com **uma única função de trigger** (`openrate.set_updated_at()`) aplicada dinamicamente a todas (26 triggers). Única exceção: `audit_log`, que é append-only e não tem `updated_at` (nem `UPDATE`/`DELETE` concedidos à aplicação).
- **RLS habilitado e FORÇADO** (`FORCE ROW LEVEL SECURITY`) em 100% das tabelas — 64 policies. Ver seção 5.
- **Role de aplicação** `openrate_app`: `NOSUPERUSER NOBYPASSRLS`, não é dona de nenhum objeto, recebe apenas `USAGE` no schema + `SELECT/INSERT/UPDATE/DELETE` por tabela (menos `UPDATE/DELETE` em `audit_log`). A migration roda com a role dona (ex.: `postgres`/`openrate_owner`) — nunca com `openrate_app`.

### Diagrama 1 — Multi-tenancy e catálogo

```mermaid
erDiagram
    organizations ||--o{ stores : "possui"
    organizations ||--o{ users : "emprega"
    users }o--o{ stores : "user_stores"
    organizations ||--o{ integrations : "configura"
    organizations |o--o{ brands : "NULL = global"
    organizations |o--o{ categories : "NULL = global"
    organizations |o--o{ products : "NULL = platform"
    stores |o--o{ products : "scope=store"
    brands |o--o{ products : ""
    categories |o--o{ products : ""
    categories |o--o{ categories : "parent"
    integrations |o--o{ products : "origin=integration"
    products ||--o{ product_images : ""
    products ||--o{ product_variations : ""
    stores ||--o{ store_inventory : ""
    products ||--o{ store_inventory : ""
    product_variations |o--o{ store_inventory : ""

    organizations {
        uuid id PK
        text slug UK
        jsonb settings
    }
    users {
        uuid id "PK = auth.users.id"
        uuid organization_id "NULL so p/ super_admin"
        enum role
        text pix_key
        text image_release_status
    }
    products {
        uuid id PK
        uuid organization_id "NULL se scope=platform"
        enum scope "store|organization|platform"
        enum origin "integration|manual|platform"
        numeric price "14,2"
    }
```

### Diagrama 2 — Conteúdo (pipeline de vídeo)

```mermaid
erDiagram
    products ||--o{ video_ideas : "40 ideias por produto"
    video_types |o--o{ video_ideas : "template de prompt"
    video_ideas |o--o{ videos : "roteiro escolhido"
    users ||--o{ videos : "creator grava"
    stores ||--o{ videos : ""
    products ||--o{ videos : ""
    videos ||--o{ video_publications : "1 por plataforma viva"
    video_publications |o--o{ affiliate_links : "link rastreável"
    users ||--o{ affiliate_links : "dono do link"

    video_ideas {
        uuid id PK
        uuid batch_id "lote de geração IA"
        text hook
        jsonb script "passos do overlay-guia"
        text ai_model
    }
    videos {
        uuid id PK
        enum status "draft..published|failed"
        text raw_key "MinIO raw/ (30d)"
        text final_key "MinIO final/ (permanente)"
        text transcript "faster-whisper"
    }
    video_publications {
        uuid id PK
        enum platform
        enum status
        bigint views_count "best-effort"
        text metrics_source "api|scrape"
    }
    affiliate_links {
        uuid id PK
        text short_code "único GLOBAL"
        text destination_url
    }
```

### Diagrama 3 — Financeiro, engajamento, CRM físico e operação

```mermaid
erDiagram
    affiliate_links |o--o{ affiliate_sales : "venda rastreada"
    affiliate_sales ||--o{ commission_entries : "1 por beneficiário"
    commission_rules |o--o{ commission_entries : "regra aplicada"
    payouts |o--o{ commission_entries : "consolidação"
    users ||--o{ payouts : "recebedor Pix"
    commission_entries |o--o{ commission_entries : "reversal_of"
    organizations ||--o{ goals : ""
    users }o--o{ achievements : "user_achievements"
    stores ||--o{ store_sales : "venda física"
    customers |o--o{ store_sales : ""
    users |o--o{ store_sales : "atendente"
    users ||--o{ notifications : ""
    organizations |o--o{ audit_log : "NULL = plataforma"

    affiliate_sales {
        uuid id PK
        enum platform
        text external_id "UNIQUE(platform,external_id)"
        enum status
        numeric gross_amount "14,2"
        numeric commissionable_amount "base do rateio"
    }
    commission_rules {
        uuid id PK
        numeric creator_pct "5,2"
        numeric store_pct "5,2"
        numeric platform_pct "5,2"
        int priority "GENERATED (especificidade)"
    }
    commission_entries {
        uuid id PK
        enum beneficiary_type "creator|store|platform"
        numeric amount "negativo só em reversão"
        enum status
        timestamptz payable_at "fim da carência"
    }
    payouts {
        uuid id PK
        enum status
        uuid idempotency_key UK
        text asaas_transfer_id UK
    }
```

---

## 2. Domínios

### 2.1 Multi-tenancy (`organizations`, `stores`, `users`, `user_stores`)

**Decisões:**

- `organizations` é o tenant raiz (rede de lojas = cliente do SaaS). `stores` sempre pertence a uma org. `user_stores` é o N:N que permite um atendente atuar em mais de uma loja (`is_default` marca a principal).
- **`users` é espelho de `auth.users` (gotrue), com o MESMO `id`, e SEM FK física** para `auth.users`. Por quê:
  1. O schema `auth` pertence ao gotrue/Supabase. Uma FK cross-schema criaria dependência de um produto sobre a estrutura interna de outro: upgrades do gotrue e operações da Admin API (delete/restore de usuário) passariam a falhar por violação de FK do OpenRate.
  2. Backup/restore por schema (`pg_dump -n openrate`) deixaria de ser restaurável isoladamente.
  3. A consistência é procedural: o provisionamento cria o usuário via Admin API do gotrue (`app_metadata: {org_id, store_id, role}`) e insere o espelho em `openrate.users` na mesma operação; um job de reconciliação periódico detecta divergências. `app_metadata` é o *snapshot* de autorização no JWT; `openrate.users`/`user_stores` é a verdade relacional.
- `users` carrega os dados operacionais do produto: chave Pix + CPF (KYC do payout Asaas), telefone (WhatsApp via Evolution) e o **gate jurídico** `image_release_status` (`pending → sent → signed`, com `revoked`) integrado ao Docuseal — vídeo só vai para aprovação com termo `signed`.
- Soft delete em `users` (`deleted_at`) com **unique parcial** `lower(email) WHERE deleted_at IS NULL`: demitiu, o e-mail fica livre para recadastro sem perder o histórico de comissões.

**Invariantes:**

- `ck_users_org_required`: `organization_id` só pode ser NULL para `role = 'super_admin'` (equipe OpenRate). Esta é a única exceção de tenancy em `users` — documentada aqui e no DDL.
- `role` no banco espelha `app_metadata.role`; nunca ler o claim top-level `role` do gotrue (é a role do Postgres, `authenticated`).

**Exemplo de linha (`users`):**

| id | organization_id | role | email | pix_key | image_release_status |
|---|---|---|---|---|---|
| `b1…01` | `a1…01` | attendant | ana@suple.shop | `+5514999990000` (phone) | signed |

### 2.2 Catálogo (`brands`, `categories`, `products`, `product_images`, `product_variations`, `store_inventory`)

**Decisões:**

- `products.scope` implementa o diferencial da spec: `store` (produto de uma loja), `organization` (compartilhado na rede), `platform` (catálogo global monetizável por qualquer atendente). `origin` registra a procedência (`integration` = ERP Olist/Tiny, `manual`, `platform`).
- **Produtos `platform` têm `organization_id NULL`** — exceção prevista na spec, garantida pelo CHECK `ck_products_platform_org` (`scope='platform' ⇔ organization_id IS NULL`). Consequência necessária: `brands`, `categories`, `product_images` e `product_variations` também aceitam `organization_id NULL` para as linhas do catálogo global (um produto global precisa de categoria/imagem globais). Leitura dessas linhas globais é liberada por policy própria (seção 5); escrita, só `super_admin`.
- Unicidade com `NULL` tratado como valor (Postgres 15): `UNIQUE NULLS NOT DISTINCT` em `(organization_id, slug)` de `categories`, `(organization_id, name)` de `brands` etc. — evita duas "Suplementos" globais.
- **Idempotência da importação de ERP**: unique parcial `(integration_id, external_id)` em `products` — rodar o sync do Olist duas vezes não duplica produto.
- `store_inventory` é o vínculo loja×produto (inclusive produto `platform` "adotado" pela loja) com estoque local e `price_override`. Unicidade `(store_id, product_id, variation_id)` com `NULLS NOT DISTINCT`.
- Imagens guardam só a `storage_key` do MinIO; resize é on-the-fly via imgproxy (`supabase_imgproxy`), sem variantes pré-geradas.

**Exemplo de linha (`products`):**

| id | organization_id | store_id | scope | origin | name | price |
|---|---|---|---|---|---|---|
| `c1…01` | `a1…01` | `s1…01` | store | integration | Whey 900g Morango | 199.90 |
| `c9…09` | NULL | NULL | platform | platform | Creatina OpenRate 300g | 99.00 |

### 2.3 Conteúdo (`video_types`, `video_ideas`, `videos`, `video_publications`, `affiliate_links`)

**Decisões:**

- `video_types` (Unboxing, Review, Antes/Depois…) carrega o `prompt_template` usado pelo job `ai-script-generation`. Linhas com `organization_id NULL` são os tipos-seed globais da plataforma; orgs podem criar os seus.
- `video_ideas`: as 40 ideias geradas por produto numa chamada de IA compartilham um `batch_id`. `script jsonb` é o array de passos que alimenta o **overlay-guia** do app. `ai_model` registra o modelo usado (`claude-sonnet-5`; fallback `claude-haiku-4-5`) — auditoria de custo/qualidade.
- `videos` é a máquina de estados do pipeline: `draft → recording → uploaded → processing → ready → approved|rejected → published` (+ `failed`). Os timestamps `uploaded_at`/`processed_at`/`approved_at` marcam as transições que importam para métricas e para a view de metas. As chaves do MinIO seguem os prefixos decididos: `raw_key` (lifecycle 30 dias), `final_key` (permanente), `thumb_key`.
- `video_publications`: 1 linha por (vídeo, plataforma). **Unique parcial** `(video_id, platform) WHERE status NOT IN ('failed','removed')` — só uma publicação "viva" por plataforma; republicar exige remover/falhar a anterior. Métricas (`views_count`…) são **best-effort** (`metrics_source: api|scrape` + `metrics_synced_at`) e **nunca alimentam o financeiro** — comissão deriva exclusivamente de `affiliate_sales`.
- `affiliate_links.short_code` é **único GLOBAL e total** (não parcial, deliberadamente): o código vive em legendas já publicadas nas redes; reciclar um código de link desativado redirecionaria tráfego antigo para destino errado. `active=false` desliga o redirect, não libera o código.

### 2.4 Financeiro (`commission_rules`, `affiliate_sales`, `commission_entries`, `payouts`)

Ver seção 4 (motor de comissão) para o algoritmo. Decisões estruturais:

- `affiliate_sales`: **`UNIQUE (platform, external_id)`** é a trava de idempotência da importação — a mesma venda reportada duas vezes (retry de job, reprocessamento de webhook) nunca duplica. `raw_payload jsonb` guarda o payload bruto da origem para auditoria/reprocessamento. Estados: `pending` (janela de cancelamento da plataforma) → `confirmed` (dispara o motor) → `cancelled`/`refunded`.
- `commission_entries` é o **livro-razão**: 1 lançamento por (venda, beneficiário), garantido por unique parcial `(affiliate_sale_id, beneficiary_type) WHERE reversal_of IS NULL` — o motor pode rodar N vezes sem duplicar. Estorno não apaga nada: cria lançamento espelho com `amount` negativo e `reversal_of` apontando o original (único caso em que `amount < 0` passa no CHECK).
- `payouts`: consolidação por (org, atendente, período). `pix_key`/`pix_key_type` são **snapshot** do cadastro no momento do fechamento (o cadastro pode mudar depois). `idempotency_key` (unique, enviada ao Asaas) garante que retry do job `payout-pix` jamais duplica transferência; `asaas_transfer_id` (unique parcial) fecha o ciclo no webhook `TRANSFER_DONE`/`TRANSFER_FAILED`. Estados: `pending_approval → approved → processing → paid|failed` — **nunca** se paga direto do webhook de venda.
- Ciclo dos lançamentos: `pending` (carência, `payable_at = confirmed_at + N dias`, N em `organizations.settings.payout_grace_days`, default 30) → `payable` → `settled` (ganhou `payout_id` no fechamento) → `paid` (payout pago) / `cancelled` (venda estornada antes do pagamento).

### 2.5 Engajamento (`goals`, `achievements`, `user_achievements`, `v_goal_progress_daily`)

- `goals` em três escopos: org inteira (`store_id NULL, user_id NULL`), loja (`store_id`) ou individual (`user_id`). `target_videos` = vídeos **enviados** no período; `target_sales_amount` é opcional. `period`: `daily|weekly|monthly`.
- **`v_goal_progress_daily`**: expande cada meta diária ativa para os usuários a que se aplica e conta, no dia corrente em `America/Sao_Paulo`, `videos_submitted` (por `uploaded_at`) e `videos_approved` (por `approved_at`), com `goal_met` e `progress_pct`. Criada com **`security_invoker = true`** (Postgres 15): a view herda o RLS das tabelas base para quem consulta — sem esse flag, view roda como dona e vazaria cross-tenant.
- `achievements` com `organization_id NULL` = conquistas globais da plataforma (`first_video`, `streak_7`…); `criteria jsonb` é avaliada pelo worker. `user_achievements` com unique `(user_id, achievement_id)`.

### 2.6 CRM físico (`customers`, `store_sales`)

- Registra a operação **offline** da loja: clientes e vendas físicas, com `user_id` = atendente (performance total do vendedor, não só como creator). `source: erp|manual` e uniques parciais em `external_id` para importação idempotente do ERP.
- **Invariante de domínio**: `store_sales` NÃO gera comissão de afiliado — o motor financeiro só olha `affiliate_sales`.

### 2.7 Operação (`integrations`, `notifications`, `audit_log`)

- `integrations.credentials_enc bytea`: segredos cifrados pela API com `extensions.pgp_sym_encrypt(<json>, OPENRATE_CRED_KEY)` — **pgcrypto já vem instalado no Supabase (schema `extensions`)**; a migration só faz `CREATE EXTENSION IF NOT EXISTS` (com fallback para `public` em Postgres de teste). A chave simétrica vive apenas no env da API; um dump do banco não expõe credenciais. `config jsonb` guarda somente o não-sensível. Credenciais **da plataforma** (ex.: conta Asaas master, chave Anthropic) não moram nesta tabela — ficam em env vars da stack (por isso `organization_id NOT NULL` aqui, sem exceção).
- `notifications`: fila lógica consumida pelo job `notifications` (BullMQ) → Evolution API (WhatsApp), Web Push (PWA, via service worker) etc. `template` identifica o evento (`goal_reached`, `video_approved`, `commission_credited`).
- `audit_log`: **append-only** — `bigint identity`, sem `updated_at` (exceção única à convenção), `UPDATE/DELETE` revogados da `openrate_app`, índice `(organization_id, created_at DESC)`. `organization_id NULL` = ação de plataforma. **Particionamento por mês e triggers de auditoria por tabela ficam para migration futura** (o particionamento exigiria PK composta com a chave de partição; no volume do MVP o índice resolve). No MVP, quem grava é a camada de serviço da API.

---

## 3. Exceções de tenancy (todas com CHECK/policy, nenhuma implícita)

| Tabela | `organization_id NULL` significa | Guarda |
|---|---|---|
| `products` | catálogo global (`scope='platform'`) | CHECK `ck_products_platform_org` |
| `users` | equipe OpenRate (`role='super_admin'`) | CHECK `ck_users_org_required` |
| `brands`, `categories`, `product_images`, `product_variations` | itens do catálogo global | escrita só via policy `super_admin_all` |
| `video_types`, `achievements` | seeds globais da plataforma | idem |
| `commission_rules` | regra global (fallback da plataforma) | idem |
| `audit_log` | ação de plataforma | append-only |

Todas as demais tabelas: `organization_id uuid NOT NULL REFERENCES openrate.organizations(id)`.

---

## 4. Motor de comissão

### 4.1 Resolução de regra — "a mais específica vence"

A especificidade é **materializada** na coluna gerada `commission_rules.priority` (soma de pesos em potências de 2, portanto sem empate ambíguo entre combinações distintas):

| Dimensão preenchida | Peso |
|---|---|
| `product_id` | 16 |
| `category_id` | 8 |
| `store_id` | 4 |
| `organization_id` | 2 |
| `platform` | 1 |

Regra de resolução, executada pelo job `commission-settlement`/motor na confirmação da venda:

1. **Candidatas** = regras `active` cuja janela (`valid_from`/`valid_until`) contém `affiliate_sales.confirmed_at` e cujas dimensões **não nulas** batem todas com o contexto da venda (`product_id`, categoria do produto, `store_id`, `organization_id`, `platform`). Dimensão `NULL` na regra = coringa. Regras com `organization_id NULL` (globais da plataforma) são candidatas para qualquer org.
2. **Vencedora** = maior `priority`; empate (mesma combinação de dimensões duplicada) → `created_at` mais recente.
3. Nenhuma candidata → venda fica `confirmed` sem lançamentos e entra em relatório de pendência (decisão deliberada: **não inventar** percentual default silencioso; a plataforma deve manter uma regra global priority 0 cadastrada).

A escala de pesos garante o comportamento esperado: uma regra só de `product_id` (16) vence qualquer combinação sem produto (máx. 8+4+2+1 = 15); `product+platform` (17) vence `product` seco (16), e assim por diante.

### 4.2 Exemplo numérico completo

Contexto: Org **Suple Shop** (`org_id = a1…`), loja **Centro**, produto **Whey 900g** (categoria *Suplementos*), venda confirmada via **Shopee Video**.

Regras cadastradas:

| # | org | store | category | product | platform | creator/store/platform % | priority |
|---|---|---|---|---|---|---|---|
| R1 | NULL | — | — | — | — | 40 / 30 / 30 | 0 |
| R2 | a1… | — | — | — | — | 45 / 35 / 20 | 2 |
| R3 | a1… | — | Suplementos | — | — | 50 / 30 / 20 | 10 |
| R4 | a1… | — | — | Whey 900g | — | 55 / 25 / 20 | 18 |
| R5 | a1… | — | — | Whey 900g | shopee_video | 60 / 20 / 20 | **19** |

Venda importada (webhook/CSV da Shopee):

```
affiliate_sales: external_id='SP-98123', platform='shopee_video',
gross_amount=250.00, commissionable_amount=30.00  -- 12% pagos pelo programa de afiliados
status: pending → confirmed (confirmed_at = 2026-07-03)
```

Todas as cinco regras são candidatas (dimensões não nulas batem); vence **R5** (priority 19). Base do rateio = `commissionable_amount` (fallback: `gross_amount` quando a origem não informa — nunca somar os dois).

Lançamentos gerados (1 por beneficiário, idempotente pelo unique parcial):

| beneficiary_type | percentage | base_amount | amount | status | payable_at |
|---|---|---|---|---|---|
| creator (Ana) | 60.00 | 30.00 | **18.00** | pending | 2026-08-02 (D+30) |
| store (Centro) | 20.00 | 30.00 | **6.00** | pending | 2026-08-02 |
| platform | 20.00 | 30.00 | **6.00** | pending | 2026-08-02 |

**Arredondamento** (responsabilidade do motor na API, documentada aqui): cada parcela é `ROUND(base × pct / 100, 2)`; a parcela `platform` é calculada por diferença (`total_rateado − creator − store`) e absorve o resíduo de centavos, garantindo `Σ amounts = ROUND(base × Σpcts / 100, 2)`. Como `Σpcts ≤ 100` (CHECK no banco), sobra eventual (`Σpcts < 100`) simplesmente **não é lançada** — recomenda-se cadastrar regras somando exatamente 100.

**Fechamento**: em 2026-08-02 os lançamentos viram `payable`; o próximo `commission-settlement` consolida os lançamentos `payable` da Ana num `payout` (`pending_approval`, R$ 18,00 + o que mais houver no período); aprovação humana → `approved` → job `payout-pix` chama o Asaas com `idempotency_key` → webhook `TRANSFER_DONE` → payout `paid` e entries `paid`.

**Estorno**: se a Shopee estornar a venda (`refunded`) antes do pagamento, o motor cria três entries espelho com `amount` negativo e `reversal_of` preenchido, e os originais vão a `cancelled`. Depois do pagamento, os negativos entram como débito no payout seguinte do beneficiário. Nada é apagado — livro-razão.

---

## 5. RLS de duas vias (PostgREST × conexão direta)

### 5.1 O problema

`auth.jwt()` do Supabase é açúcar sobre `current_setting('request.jwt.claims')` — e quem popula esse setting é o **PostgREST** a cada request. A API NestJS conecta **direto** em `supabase_db:5432`; nessa conexão o setting está vazio, `auth.jwt()` retorna NULL e toda policy baseada nele nega (ou pior: se a role fosse dona das tabelas, o RLS nem se aplicaria). Detalhe completo em [`01-analise-critica.md §2.1`](./01-analise-critica.md).

### 5.2 A solução no schema

A função `openrate.jwt_claims()` lê os claims de **duas fontes, na ordem**:

1. `current_setting('request.jwt.claims', true)` — populado **tanto** pelo PostgREST (se um dia o schema for exposto via `supabase_rest`) **quanto** pela API via `set_config` em conexão direta;
2. fallback `auth.jwt()`, dentro de `BEGIN/EXCEPTION` — não quebra em Postgres sem o schema `auth` (CI/testes) nem quando a role não tem privilégio no schema `auth` (caso da `openrate_app`).

Sobre ela: `current_org_id()`, `current_user_id()` (claim `sub`), `current_user_role()` (**sempre** `app_metadata.role` — o claim top-level `role` do gotrue é a role do Postgres, não a de negócio) e `is_super_admin()`.

Policies padrão aplicadas dinamicamente a toda tabela com `organization_id`:

```sql
CREATE POLICY tenant_isolation ON openrate.<tabela>
  FOR ALL
  USING     (organization_id = openrate.current_org_id())
  WITH CHECK (organization_id = openrate.current_org_id());

CREATE POLICY super_admin_all ON openrate.<tabela>
  FOR ALL
  USING (openrate.is_super_admin())
  WITH CHECK (openrate.is_super_admin());
```

Extras: `platform_read` (SELECT das linhas globais `organization_id IS NULL` **apenas com claims presentes**) em `products`/`brands`/`categories`/`video_types`/`achievements`/`product_images`/`product_variations`/`commission_rules`; `self_read` em `users`; policies próprias em `organizations` (o tenant é a própria linha). `FORCE ROW LEVEL SECURITY` em tudo: nem a dona das tabelas escapa (só superuser/`BYPASSRLS`, que a `openrate_app` não tem).

### 5.3 O contrato da API (conexão direta)

Todo acesso tenant-scoped abre transação e injeta os claims **validados** (assinatura conferida com `SUPABASE_JWT_SECRET`), com `is_local = true`:

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"<user_id>",
    "app_metadata":{"org_id":"<org>","store_id":"<store>","role":"manager"}}',
  true);  -- true (is_local): morre no COMMIT — obrigatório com pool de conexões
-- ... queries do request ...
COMMIT;
```

No NestJS (interceptor + pool `pg`):

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: user.id, app_metadata: { org_id, store_id, role } }),
  ]);
  // ... repositórios usam este client durante o request ...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

O `true` do `set_config` é inegociável: sem escopo de transação, os claims de um request **vazariam** para o próximo request que reutilizar a conexão do pool — cross-tenant leak clássico. Validado no teste da migration: após o `COMMIT`, a mesma conexão volta a enxergar zero linhas.

**RLS é defesa em profundidade, não a única defesa**: a camada de serviço continua filtrando `WHERE organization_id = $1` e comparando o `org_id` do JWT com o recurso. O RLS do banco é isolamento **por organização**; autorização fina (attendant só vê os próprios payouts, manager aprova vídeo etc.) é responsabilidade da API. Suíte de regressão multi-tenant (org A tenta ler/escrever org B em todos os endpoints) é obrigatória.

### 5.4 Comportamento verificado (teste executado na migration)

| Cenário | Resultado |
|---|---|
| Sem claims | 0 linhas em tudo (inclusive catálogo platform) |
| Claims org A | vê org A + produtos `platform`; não vê org B |
| Escrita cross-tenant (org A → store da org B) | bloqueada (`WITH CHECK`) |
| Claims `role=super_admin` | vê tudo |
| Após `COMMIT` (mesma conexão) | claims zerados, 0 linhas |
| `UPDATE` em `audit_log` como `openrate_app` | `insufficient_privilege` |

---

## 6. Convivência no `supabase_db` compartilhado

O Postgres 15.8 do Supabase atende outros produtos do servidor. Regras de coabitação:

### 6.1 Isolamento

- **Schema**: 100% dos objetos em `openrate`. Migrations com `SET search_path TO openrate, public` e nomes sempre qualificados. Única operação fora do schema: `CREATE EXTENSION IF NOT EXISTS pgcrypto` — no Supabase é no-op (já instalada em `extensions`).
- **Role**: `openrate_app` com `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, `REVOKE ALL ON SCHEMA public`, grants só no schema `openrate`, e **não dona** de nenhum objeto. Migrations rodam com role separada (dona do schema). Conexão da API: `postgresql://openrate_app:***@supabase_db:5432/postgres?options=-csearch_path%3Dopenrate` (ou `search_path` na config do pool).

### 6.2 Proibido

- Criar/alterar/ler objetos em `auth`, `storage`, `public`, `graphql*`, `realtime`, `_analytics` ou schemas de outros produtos. A integração com o gotrue é **exclusivamente** via Admin API HTTP (`supabase_auth`), nunca por SQL no schema `auth`.
- FK, trigger, view ou função referenciando objetos fora de `openrate` (exceção: chamadas runtime a `extensions.pgp_sym_encrypt/decrypt` e o fallback protegido a `auth.jwt()` dentro de `jwt_claims()` — ambos degradam graciosamente se indisponíveis).
- Alterar configuração global do Postgres (`ALTER SYSTEM`, parâmetros de `postgresql.conf`), criar publication/subscription, ou instalar extensões além do que o Supabase já traz.
- Conectar como `postgres`/`supabase_admin` em runtime. Superuser só em migration/runbook, manualmente.

### 6.3 Backup por schema

- **Dump lógico diário**: `pg_dump -h supabase_db -U <role_dona> -n openrate -Fc -f openrate_$(date +%F).dump postgres`, gravado em `s3://openrate-backups/` no MinIO (retenção 30 dias via lifecycle) + cópia semanal para fora do servidor (MinIO está no mesmo disco do banco — backup local não sobrevive à perda do host).
- **Restore testado mensalmente** num Postgres descartável: `pg_restore -d postgres --schema openrate openrate_X.dump` — é exatamente por isso que não há FK cross-schema: o dump do schema restaura sozinho.
- O que o dump do schema **não** cobre: `auth.users` (credenciais/identidades) pertence à rotina de backup do Supabase do servidor. Em disaster recovery, restaurar `openrate` + recriar usuários via Admin API a partir do espelho `openrate.users` (e-mail/telefone/role preservados; senhas são redefinidas por invite — aceitável por design).
- Migrations versionadas no repositório (`db/migrations/000N_*.sql`, dbmate ou prisma migrate) são a fonte de verdade do DDL; o dump é de dados.

### 6.4 Pooling

Supavisor (pooler do Supabase) em modo transaction quebra o padrão `set_config + BEGIN/COMMIT`? Não — o padrão foi desenhado para isso: claims com `is_local=true` vivem exatamente uma transação, que é a unidade do pooling por transação. Ainda assim, a API usa **pool próprio do driver direto em `supabase_db:5432`** (decisão fechada), com `max` conservador (ex.: 10) para não disputar `max_connections` com os demais produtos do servidor.

---

## 7. Próximas migrations (planejado, fora do 0001)

1. `0002_audit_triggers.sql` — triggers de auditoria por tabela crítica (`commission_entries`, `payouts`, `commission_rules`) gravando em `audit_log`.
2. Particionamento mensal de `audit_log` quando o volume justificar (requer recriação com PK composta).
3. Views materializadas de ranking/leaderboard (gamificação, Fase 3) com refresh via job BullMQ.
4. Tabela de eventos de clique do redirecionador de `affiliate_links` (hoje só o contador agregado `clicks_count`), se a análise de funil exigir granularidade.
