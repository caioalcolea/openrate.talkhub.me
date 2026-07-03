-- ============================================================================
-- OpenRate — Migration 0001_init
-- Schema dedicado "openrate" no Postgres 15 compartilhado (supabase_db).
--
-- PRÉ-REQUISITOS (runbook de provisionamento, FORA desta migration):
--   1. Role de aplicação criada:
--        CREATE ROLE openrate_app LOGIN PASSWORD '...'
--          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
--        REVOKE ALL ON SCHEMA public FROM openrate_app;
--   2. Esta migration roda com uma role DONA do schema (ex.: postgres ou
--      openrate_owner) — NUNCA com openrate_app. A role de aplicação não é
--      dona de nenhum objeto, justamente para o RLS valer para ela.
--
-- COMO APLICAR:
--   * dbmate (nativo):  dbmate --migrations-table openrate.schema_migrations up
--     (o arquivo traz os marcadores de migracao up/down em coluna 0)
--   * psql direto (sem o bloco down): cortar do marcador down em diante com o
--     sed ANCORADO em inicio de linha (^) para nao casar com esta documentacao —
--       sed '/^-- migrate:down/,$d' 0001_init.sql | psql "$URL" --single-transaction -v ON_ERROR_STOP=1
--     (o runbook passo 3.3 ja faz isso; NUNCA rodar o arquivo inteiro no psql,
--      senao o bloco down ao final apaga o schema recem-criado)
--
-- GARANTIAS:
--   - Nenhum objeto criado fora do schema "openrate" (exceto a extensão
--     pgcrypto, que no Supabase já existe no schema "extensions").
--   - Nenhuma alteração em schemas de outros produtos (auth, storage, public).
-- ============================================================================

-- migrate:up

-- ----------------------------------------------------------------------------
-- 0. Guarda de pré-requisito: a role openrate_app precisa existir E ser segura.
--    O isolamento multi-tenant depende de a role de RUNTIME não conseguir
--    ignorar RLS. Se ela for SUPERUSER ou tiver BYPASSRLS, todo o FORCE RLS
--    desta migration é silenciosamente anulado — por isso a migration RECUSA
--    um provisionamento inseguro em vez de aplicar um schema falsamente isolado.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'openrate_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Role "openrate_app" nao existe. Execute o runbook de provisionamento antes desta migration.';
  END IF;
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION
      'Role "openrate_app" tem SUPERUSER/BYPASSRLS — isso anula o RLS. Recrie-a como NOSUPERUSER NOBYPASSRLS (ver runbook passo 3.2).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Schema e search_path
--    O schema normalmente já é criado pelo runbook (passo 3.2, como postgres,
--    AUTHORIZATION openrate_owner). O guard abaixo evita chamar CREATE SCHEMA
--    quando ele já existe: `CREATE SCHEMA IF NOT EXISTS` verifica o privilégio
--    de CREATE no database ANTES da existência e falharia para a role de
--    migração NOSUPERUSER. Em Postgres vanilla (teste, como superuser) o guard
--    cria o schema normalmente.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'openrate') THEN
    EXECUTE 'CREATE SCHEMA openrate';
  END IF;
END $$;

SET search_path TO openrate, public;

-- ----------------------------------------------------------------------------
-- 2. Extensões
--    pgcrypto: usada pela API para cifrar integrations.credentials_enc via
--    pgp_sym_encrypt/pgp_sym_decrypt. No Supabase a extensão JÁ VEM instalada
--    no schema "extensions"; o bloco abaixo só garante idempotência e cobre
--    ambientes de teste (Postgres vanilla, onde cai no schema public).
--    gen_random_uuid() é nativo do Postgres >= 13 (não depende de pgcrypto).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Se pgcrypto já existe (caso do Supabase), NÃO chamar CREATE EXTENSION:
  -- ela exige privilégio de superusuário/CREATE no database, que a role de
  -- migração (openrate_owner, NOSUPERUSER) não tem. Só cria em Postgres vanilla
  -- (teste), onde a migration roda como superuser.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions';
    ELSE
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Tipos ENUM (todos no schema openrate)
-- ----------------------------------------------------------------------------
CREATE TYPE openrate.user_role AS ENUM (
  'super_admin',   -- equipe OpenRate (organization_id NULL permitido)
  'owner',         -- dono da rede de lojas
  'manager',       -- gerente de loja
  'attendant'      -- vendedor/creator
);

CREATE TYPE openrate.product_scope AS ENUM (
  'store',         -- produto de uma loja específica
  'organization',  -- produto compartilhado entre lojas da org
  'platform'       -- catálogo global da plataforma (organization_id NULL)
);

CREATE TYPE openrate.product_origin AS ENUM (
  'integration',   -- importado de ERP (Olist/Tiny)
  'manual',        -- cadastrado no painel
  'platform'       -- criado pela equipe OpenRate
);

CREATE TYPE openrate.video_status AS ENUM (
  'draft',         -- ideia escolhida, gravação não iniciada
  'recording',     -- sessão de gravação aberta no app
  'uploaded',      -- multipart concluído no MinIO (raw/)
  'processing',    -- job video-processing em execução (FFmpeg/whisper)
  'ready',         -- vídeo final gerado, aguardando aprovação do manager
  'approved',      -- aprovado para publicação
  'rejected',      -- reprovado pelo manager (rejected_reason preenchido)
  'published',     -- ao menos uma publicação ativa
  'failed'         -- falha de processamento (processing_error preenchido)
);

CREATE TYPE openrate.publication_platform AS ENUM (
  'tiktok',
  'instagram_reels',
  'shopee_video',
  'kwai',
  'mercado_livre_clips',
  'youtube_shorts'
);

CREATE TYPE openrate.publication_status AS ENUM (
  'pending',       -- criada, aguardando ação (publicação manual assistida)
  'scheduled',     -- agendada
  'publishing',    -- adapter executando
  'published',     -- no ar (external_url preenchida)
  'failed',        -- adapter falhou (failure_reason)
  'removed'        -- despublicada (ex.: revogação de cessão de imagem)
);

CREATE TYPE openrate.sale_status AS ENUM (
  'pending',       -- reportada pela plataforma, dentro da janela de cancelamento
  'confirmed',     -- confirmada (dispara o motor de comissão)
  'cancelled',     -- cancelada antes da confirmação
  'refunded'       -- estornada após confirmação (gera entries de reversão)
);

CREATE TYPE openrate.commission_entry_status AS ENUM (
  'pending',       -- criado, aguardando carência (payable_at no futuro)
  'payable',       -- carência vencida, elegível para o próximo fechamento
  'settled',       -- consolidado em um payout (payout_id preenchido)
  'paid',          -- payout correspondente pago
  'cancelled'      -- anulado (venda cancelada/estornada)
);

CREATE TYPE openrate.payout_status AS ENUM (
  'pending_approval', -- gerado pelo fechamento, aguardando aprovação humana
  'approved',         -- aprovado, aguardando job payout-pix
  'processing',       -- transferência enviada ao Asaas, aguardando webhook
  'paid',             -- TRANSFER_DONE recebido
  'failed',           -- TRANSFER_FAILED recebido (failed_reason)
  'cancelled'         -- cancelado antes do envio
);

CREATE TYPE openrate.goal_period AS ENUM (
  'daily',
  'weekly',
  'monthly'
);

CREATE TYPE openrate.integration_provider AS ENUM (
  'olist',
  'tiny',
  'asaas',
  'evolution',
  'docuseal',
  'tiktok',
  'instagram',
  'shopee',
  'kwai',
  'mercado_livre',
  'youtube',
  'other'
);

CREATE TYPE openrate.notification_channel AS ENUM (
  'whatsapp',      -- via Evolution API
  'push',          -- Web Push (PWA / navegador, via service worker)
  'email',
  'in_app'
);

-- Beneficiário de um lançamento de comissão (enum auxiliar, não listado na
-- spec mas necessário para tipar commission_entries.beneficiary_type)
CREATE TYPE openrate.commission_beneficiary AS ENUM (
  'creator',
  'store',
  'platform'
);

-- ----------------------------------------------------------------------------
-- 4. Funções auxiliares (JWT claims de duas fontes + updated_at)
-- ----------------------------------------------------------------------------

-- Lê os claims do JWT de DUAS fontes, nesta ordem:
--   1) current_setting('request.jwt.claims') — populado pelo PostgREST
--      (supabase_rest) OU pela API NestJS via
--      set_config('request.jwt.claims', <json>, true) em conexão direta.
--   2) auth.jwt() — açúcar do Supabase; protegido por EXCEPTION porque a
--      função pode não existir (Postgres de teste) ou a role pode não ter
--      privilégio no schema auth (caso da openrate_app).
CREATE OR REPLACE FUNCTION openrate.jwt_claims()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
BEGIN
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;

  IF claims IS NOT NULL THEN
    RETURN claims;
  END IF;

  BEGIN
    claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;

  RETURN claims;
END;
$$;

COMMENT ON FUNCTION openrate.jwt_claims() IS
  'Claims do JWT via request.jwt.claims (PostgREST ou set_config da API) com fallback protegido para auth.jwt().';

-- org_id do tenant corrente. Aceita o claim tanto em app_metadata.org_id
-- (formato do gotrue) quanto no topo do JSON (formato simplificado).
CREATE OR REPLACE FUNCTION openrate.current_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c jsonb := openrate.jwt_claims();
BEGIN
  IF c IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE(c -> 'app_metadata' ->> 'org_id', c ->> 'org_id')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- sub do JWT = id do usuário (auth.users.id = openrate.users.id)
CREATE OR REPLACE FUNCTION openrate.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c jsonb := openrate.jwt_claims();
BEGIN
  IF c IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (c ->> 'sub')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Role de NEGÓCIO (super_admin/owner/manager/attendant). Lida SEMPRE de
-- app_metadata.role — nunca do claim top-level "role", que no gotrue é a
-- role do Postgres ('authenticated') e não a role do produto.
CREATE OR REPLACE FUNCTION openrate.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c jsonb := openrate.jwt_claims();
BEGIN
  IF c IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN c -> 'app_metadata' ->> 'role';
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION openrate.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT openrate.current_user_role() = 'super_admin';
$$;

-- Trigger única de updated_at, aplicada a todas as tabelas na seção 7.
CREATE OR REPLACE FUNCTION openrate.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Tabelas (ordem respeita dependências de FK)
-- ----------------------------------------------------------------------------

-- ===== 5.1 Multi-tenancy ====================================================

CREATE TABLE openrate.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL,
  document      text,                              -- CNPJ da rede (opcional)
  settings      jsonb NOT NULL DEFAULT '{}',       -- ex.: {"payout_grace_days": 30}
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organizations_slug UNIQUE (slug)
);
COMMENT ON TABLE openrate.organizations IS 'Tenant raiz: rede de lojas (cliente do SaaS).';

CREATE TABLE openrate.stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  name            text NOT NULL,
  slug            text NOT NULL,
  document        text,                            -- CNPJ da filial (opcional)
  address         jsonb NOT NULL DEFAULT '{}',
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stores_org_slug UNIQUE (organization_id, slug)
);
COMMENT ON TABLE openrate.stores IS 'Loja física pertencente a uma organization.';

-- Espelho de auth.users (gotrue). id = auth.users.id, SEM FK física:
--   1) o schema "auth" pertence ao gotrue/Supabase — FK cross-schema criaria
--      dependência que quebra upgrades do gotrue e operações da Admin API
--      (delete/restore de usuário falharia por violação de FK do OpenRate);
--   2) backup/restore por schema (pg_dump -n openrate) ficaria irrestaurável
--      isoladamente com FK apontando para fora do schema;
--   3) a consistência é garantida pelo fluxo de provisionamento (Admin API
--      cria em auth.users e a API insere aqui na mesma operação) + job de
--      reconciliação periódico.
CREATE TABLE openrate.users (
  id                      uuid PRIMARY KEY,        -- MESMO id de auth.users
  organization_id         uuid REFERENCES openrate.organizations(id),
  role                    openrate.user_role NOT NULL DEFAULT 'attendant',
  email                   text NOT NULL,
  full_name               text NOT NULL,
  phone                   text,                    -- E.164; alvo do WhatsApp (Evolution)
  avatar_url              text,
  cpf                     text,                    -- exigido antes do 1º payout (KYC Asaas)
  pix_key                 text,
  pix_key_type            text CHECK (pix_key_type IN ('cpf','cnpj','email','phone','evp')),
  image_release_status    text NOT NULL DEFAULT 'pending'
                            CHECK (image_release_status IN ('pending','sent','signed','revoked')),
  image_release_doc_key   text,                    -- PDF assinado no MinIO (prefixo legal/)
  image_release_signed_at timestamptz,
  active                  boolean NOT NULL DEFAULT true,
  deleted_at              timestamptz,             -- soft delete (libera o e-mail)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- Exceção documentada: só super_admin (equipe OpenRate) vive sem org.
  CONSTRAINT ck_users_org_required CHECK (organization_id IS NOT NULL OR role = 'super_admin')
);
COMMENT ON TABLE openrate.users IS 'Espelho de auth.users com dados de negócio. Sem FK física para auth.users (ver comentário na migration).';

CREATE TABLE openrate.user_stores (
  user_id         uuid NOT NULL REFERENCES openrate.users(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES openrate.stores(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);
COMMENT ON TABLE openrate.user_stores IS 'N:N usuário x loja (atendente pode atuar em mais de uma loja).';

-- ===== 5.2 Operação (integrations vem antes de products por FK) =============

CREATE TABLE openrate.integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id        uuid REFERENCES openrate.stores(id),
  provider        openrate.integration_provider NOT NULL,
  name            text NOT NULL,
  -- Segredos cifrados pela API com extensions.pgp_sym_encrypt(<json>, <chave>).
  -- A chave simétrica vive APENAS no env da API (OPENRATE_CRED_KEY), nunca no banco.
  credentials_enc bytea,
  config          jsonb NOT NULL DEFAULT '{}',     -- somente dados NÃO sensíveis
  active          boolean NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integrations_org_provider_store
    UNIQUE NULLS NOT DISTINCT (organization_id, provider, store_id)
);
COMMENT ON COLUMN openrate.integrations.credentials_enc IS
  'pgp_sym_encrypt(json, OPENRATE_CRED_KEY). Credenciais de plataforma (nível OpenRate, ex.: conta Asaas master) ficam em env vars, não aqui.';

-- ===== 5.3 Catálogo =========================================================

CREATE TABLE openrate.brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL = marca global (catálogo da plataforma)
  name            text NOT NULL,
  logo_key        text,                            -- objeto no MinIO; servir via imgproxy
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_brands_org_name UNIQUE NULLS NOT DISTINCT (organization_id, name)
);

CREATE TABLE openrate.categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL = categoria global
  parent_id       uuid REFERENCES openrate.categories(id),
  name            text NOT NULL,
  slug            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_categories_org_slug UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

CREATE TABLE openrate.products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),
  store_id        uuid REFERENCES openrate.stores(id),
  scope           openrate.product_scope NOT NULL DEFAULT 'store',
  origin          openrate.product_origin NOT NULL DEFAULT 'manual',
  brand_id        uuid REFERENCES openrate.brands(id),
  category_id     uuid REFERENCES openrate.categories(id),
  integration_id  uuid REFERENCES openrate.integrations(id),
  external_id     text,                            -- id do produto no ERP (Olist/Tiny)
  name            text NOT NULL,
  description     text,
  sku             text,
  gtin            text,                            -- código de barras
  price           numeric(14,2) CHECK (price IS NULL OR price >= 0),
  promo_price     numeric(14,2) CHECK (promo_price IS NULL OR promo_price >= 0),
  attributes      jsonb NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Única exceção de tenancy prevista na spec: catálogo global da plataforma.
  CONSTRAINT ck_products_platform_org CHECK (
    (scope = 'platform' AND organization_id IS NULL)
    OR (scope <> 'platform' AND organization_id IS NOT NULL)
  ),
  CONSTRAINT ck_products_store_scope CHECK (scope <> 'store' OR store_id IS NOT NULL),
  CONSTRAINT ck_products_integration CHECK (origin <> 'integration' OR integration_id IS NOT NULL)
);
COMMENT ON TABLE openrate.products IS 'Produto em três escopos: store (da loja), organization (da rede), platform (catálogo global, organization_id NULL).';

CREATE TABLE openrate.product_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL somente para imagens de produto platform
  product_id      uuid NOT NULL REFERENCES openrate.products(id) ON DELETE CASCADE,
  storage_key     text NOT NULL,                   -- chave no MinIO; resize on-the-fly via imgproxy
  alt             text,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.product_variations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL somente para variações de produto platform
  product_id      uuid NOT NULL REFERENCES openrate.products(id) ON DELETE CASCADE,
  name            text NOT NULL,                   -- ex.: "Sabor morango 900g"
  sku             text,
  price           numeric(14,2) CHECK (price IS NULL OR price >= 0),
  attributes      jsonb NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.store_inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id        uuid NOT NULL REFERENCES openrate.stores(id),
  product_id      uuid NOT NULL REFERENCES openrate.products(id),
  variation_id    uuid REFERENCES openrate.product_variations(id),
  quantity        integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  price_override  numeric(14,2) CHECK (price_override IS NULL OR price_override >= 0),
  available       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_inventory UNIQUE NULLS NOT DISTINCT (store_id, product_id, variation_id)
);
COMMENT ON TABLE openrate.store_inventory IS 'Vínculo loja x produto (inclusive produtos platform "adotados" pela loja) com estoque e preço local.';

-- ===== 5.4 Conteúdo =========================================================

CREATE TABLE openrate.video_types (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid REFERENCES openrate.organizations(id),  -- NULL = tipo global (seed da plataforma)
  name                     text NOT NULL,          -- ex.: "Unboxing", "Review", "Antes e depois"
  slug                     text NOT NULL,
  description              text,
  prompt_template          text,                   -- template usado pelo job ai-script-generation
  default_duration_seconds integer,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_video_types_org_slug UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

CREATE TABLE openrate.video_ideas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES openrate.organizations(id),
  product_id              uuid NOT NULL REFERENCES openrate.products(id),
  video_type_id           uuid REFERENCES openrate.video_types(id),
  batch_id                uuid,                    -- agrupa as 40 ideias geradas numa mesma chamada de IA
  hook                    text NOT NULL,           -- frase de abertura
  script                  jsonb NOT NULL DEFAULT '[]',  -- passos do roteiro (array; alimenta o overlay-guia)
  caption                 text,
  hashtags                text[] NOT NULL DEFAULT '{}',
  target_duration_seconds integer,
  source                  text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  ai_model                text,                    -- ex.: claude-sonnet-5 / claude-haiku-4-5
  used_count              integer NOT NULL DEFAULT 0,
  archived                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id         uuid NOT NULL REFERENCES openrate.stores(id),
  user_id          uuid NOT NULL REFERENCES openrate.users(id),      -- creator
  product_id       uuid NOT NULL REFERENCES openrate.products(id),
  video_idea_id    uuid REFERENCES openrate.video_ideas(id) ON DELETE SET NULL,
  status           openrate.video_status NOT NULL DEFAULT 'draft',
  title            text,
  raw_key          text,       -- MinIO: raw/{org_id}/{video_id}/source.mp4 (lifecycle 30d)
  final_key        text,       -- MinIO: final/{org_id}/{video_id}/final.mp4 (permanente)
  thumb_key        text,       -- MinIO: thumbs/...
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  width            integer,
  height           integer,
  size_bytes       bigint,
  transcript       text,       -- gerado por faster-whisper (legendas)
  transcript_lang  text,
  processing_error text,
  uploaded_at      timestamptz,   -- CompleteMultipartUpload confirmado
  processed_at     timestamptz,
  approved_at      timestamptz,
  approved_by      uuid REFERENCES openrate.users(id),
  rejected_reason  text,
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.video_publications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES openrate.organizations(id),
  video_id          uuid NOT NULL REFERENCES openrate.videos(id),
  platform          openrate.publication_platform NOT NULL,
  status            openrate.publication_status NOT NULL DEFAULT 'pending',
  external_id       text,       -- id do post na plataforma (quando a API fornece)
  external_url      text,       -- URL pública do post (alvo do metrics-sync)
  caption           text,       -- legenda efetivamente usada
  published_at      timestamptz,
  failure_reason    text,
  -- métricas best-effort (comissão NUNCA deriva daqui — só de affiliate_sales)
  views_count       bigint NOT NULL DEFAULT 0,
  likes_count       bigint NOT NULL DEFAULT 0,
  comments_count    bigint NOT NULL DEFAULT 0,
  shares_count      bigint NOT NULL DEFAULT 0,
  metrics_source    text CHECK (metrics_source IN ('api','scrape')),
  metrics_synced_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.affiliate_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id             uuid REFERENCES openrate.stores(id),
  user_id              uuid NOT NULL REFERENCES openrate.users(id),   -- creator dono do link
  product_id           uuid REFERENCES openrate.products(id),
  video_publication_id uuid REFERENCES openrate.video_publications(id),
  platform             openrate.publication_platform,
  short_code           text NOT NULL,   -- código do redirecionador (r.openrate...)
  destination_url      text NOT NULL,   -- URL de afiliado na plataforma de venda
  clicks_count         bigint NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT false,  -- desativa o redirect, não libera o código
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN openrate.affiliate_links.short_code IS
  'Único GLOBAL e permanente (índice total, não parcial): o código vive em legendas já publicadas — nunca pode ser reciclado para outro destino.';

-- ===== 5.5 Financeiro =======================================================

CREATE TABLE openrate.commission_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = regra global da plataforma (criada por super_admin)
  organization_id uuid REFERENCES openrate.organizations(id),
  store_id        uuid REFERENCES openrate.stores(id),
  product_id      uuid REFERENCES openrate.products(id),
  category_id     uuid REFERENCES openrate.categories(id),
  platform        openrate.publication_platform,
  name            text NOT NULL,
  creator_pct     numeric(5,2) NOT NULL CHECK (creator_pct  >= 0 AND creator_pct  <= 100),
  store_pct       numeric(5,2) NOT NULL CHECK (store_pct    >= 0 AND store_pct    <= 100),
  platform_pct    numeric(5,2) NOT NULL CHECK (platform_pct >= 0 AND platform_pct <= 100),
  -- Especificidade "mais específica vence", materializada como soma de pesos:
  -- product(16) > category(8) > store(4) > organization(2) > platform(1).
  -- Resolução: maior priority vence; empate -> created_at mais recente.
  priority        integer GENERATED ALWAYS AS (
                    (CASE WHEN product_id      IS NOT NULL THEN 16 ELSE 0 END) +
                    (CASE WHEN category_id     IS NOT NULL THEN  8 ELSE 0 END) +
                    (CASE WHEN store_id        IS NOT NULL THEN  4 ELSE 0 END) +
                    (CASE WHEN organization_id IS NOT NULL THEN  2 ELSE 0 END) +
                    (CASE WHEN platform        IS NOT NULL THEN  1 ELSE 0 END)
                  ) STORED,
  active          boolean NOT NULL DEFAULT true,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_until     timestamptz,
  created_by      uuid REFERENCES openrate.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_commission_rules_sum CHECK (creator_pct + store_pct + platform_pct <= 100),
  CONSTRAINT ck_commission_rules_store_org CHECK (store_id IS NULL OR organization_id IS NOT NULL),
  CONSTRAINT ck_commission_rules_window CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE openrate.affiliate_sales (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id              uuid REFERENCES openrate.stores(id),
  affiliate_link_id     uuid REFERENCES openrate.affiliate_links(id),
  user_id               uuid REFERENCES openrate.users(id),           -- creator creditado
  product_id            uuid REFERENCES openrate.products(id),
  platform              openrate.publication_platform NOT NULL,
  external_id           text NOT NULL,             -- id da venda na plataforma de origem
  status                openrate.sale_status NOT NULL DEFAULT 'pending',
  gross_amount          numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  -- Base do rateio: a comissão de afiliado paga pela plataforma de venda.
  -- Se a origem não informa, a API calcula/preenche na importação.
  commissionable_amount numeric(14,2) CHECK (commissionable_amount IS NULL OR commissionable_amount >= 0),
  currency              char(3) NOT NULL DEFAULT 'BRL',
  occurred_at           timestamptz NOT NULL,
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  raw_payload           jsonb NOT NULL DEFAULT '{}',  -- payload bruto da importação (auditoria)
  imported_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Idempotência de importação: a mesma venda nunca entra duas vezes.
  CONSTRAINT uq_affiliate_sales_platform_ext UNIQUE (platform, external_id)
);

CREATE TABLE openrate.payouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES openrate.organizations(id),
  user_id           uuid NOT NULL REFERENCES openrate.users(id),      -- atendente recebedor
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  total_amount      numeric(14,2) NOT NULL CHECK (total_amount > 0),
  status            openrate.payout_status NOT NULL DEFAULT 'pending_approval',
  -- snapshot dos dados Pix NO MOMENTO do payout (o cadastro pode mudar depois)
  pix_key           text,
  pix_key_type      text,
  asaas_transfer_id text,
  idempotency_key   uuid NOT NULL DEFAULT gen_random_uuid(),  -- enviada ao Asaas; retry jamais duplica transferência
  approved_by       uuid REFERENCES openrate.users(id),
  approved_at       timestamptz,
  paid_at           timestamptz,
  failed_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payouts_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT ck_payouts_period CHECK (period_end >= period_start)
);

CREATE TABLE openrate.commission_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES openrate.organizations(id),
  affiliate_sale_id  uuid NOT NULL REFERENCES openrate.affiliate_sales(id),
  commission_rule_id uuid REFERENCES openrate.commission_rules(id),   -- regra aplicada (auditoria)
  beneficiary_type   openrate.commission_beneficiary NOT NULL,
  user_id            uuid REFERENCES openrate.users(id),              -- quando beneficiary_type = creator
  store_id           uuid REFERENCES openrate.stores(id),             -- quando beneficiary_type = store
  percentage         numeric(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  base_amount        numeric(14,2) NOT NULL,        -- snapshot da base usada no cálculo
  amount             numeric(14,2) NOT NULL,        -- valor do lançamento (negativo apenas em reversão)
  status             openrate.commission_entry_status NOT NULL DEFAULT 'pending',
  payable_at         timestamptz,                   -- fim da carência (ex.: confirmed_at + 30d)
  payout_id          uuid REFERENCES openrate.payouts(id),
  reversal_of        uuid REFERENCES openrate.commission_entries(id), -- lançamento estornado por este
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_entries_beneficiary CHECK (
    (beneficiary_type = 'creator'  AND user_id IS NOT NULL)
    OR (beneficiary_type = 'store' AND store_id IS NOT NULL)
    OR (beneficiary_type = 'platform')
  ),
  CONSTRAINT ck_entries_amount_sign CHECK (amount >= 0 OR reversal_of IS NOT NULL)
);
-- Idempotência do motor: 1 lançamento por (venda, beneficiário); reversões fora da regra.
CREATE UNIQUE INDEX uq_entries_sale_beneficiary
  ON openrate.commission_entries (affiliate_sale_id, beneficiary_type)
  WHERE reversal_of IS NULL;

-- ===== 5.6 Engajamento ======================================================

CREATE TABLE openrate.goals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id            uuid REFERENCES openrate.stores(id),   -- NULL = meta da org inteira
  user_id             uuid REFERENCES openrate.users(id),    -- NULL = vale para todos os attendants do escopo
  name                text NOT NULL,
  period              openrate.goal_period NOT NULL,
  target_videos       integer NOT NULL CHECK (target_videos > 0),  -- vídeos ENVIADOS no período
  target_sales_amount numeric(14,2) CHECK (target_sales_amount IS NULL OR target_sales_amount >= 0),
  active              boolean NOT NULL DEFAULT true,
  valid_from          date,
  valid_until         date,
  created_by          uuid REFERENCES openrate.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.achievements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL = conquista global da plataforma
  code            text NOT NULL,                   -- ex.: first_video, streak_7
  name            text NOT NULL,
  description     text,
  icon            text,
  points          integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  criteria        jsonb NOT NULL DEFAULT '{}',     -- regra avaliada pelo worker
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_achievements_org_code UNIQUE NULLS NOT DISTINCT (organization_id, code)
);

CREATE TABLE openrate.user_achievements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  user_id         uuid NOT NULL REFERENCES openrate.users(id) ON DELETE CASCADE,
  achievement_id  uuid NOT NULL REFERENCES openrate.achievements(id),
  earned_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_achievements UNIQUE (user_id, achievement_id)
);

-- ===== 5.7 CRM físico =======================================================

CREATE TABLE openrate.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id        uuid REFERENCES openrate.stores(id),
  external_id     text,                            -- id do cliente no ERP
  name            text NOT NULL,
  phone           text,
  email           text,
  cpf             text,
  birthdate       date,
  tags            text[] NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE openrate.store_sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id        uuid NOT NULL REFERENCES openrate.stores(id),
  customer_id     uuid REFERENCES openrate.customers(id),
  user_id         uuid REFERENCES openrate.users(id),   -- atendente da venda física
  external_id     text,                            -- id da venda no ERP
  total_amount    numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  items           jsonb NOT NULL DEFAULT '[]',
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('erp','manual')),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE openrate.store_sales IS 'Venda da loja física (CRM/performance offline do atendente). NÃO gera comissão de afiliado.';

-- ===== 5.8 Operação (continuação) ===========================================

CREATE TABLE openrate.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  user_id         uuid NOT NULL REFERENCES openrate.users(id) ON DELETE CASCADE,
  channel         openrate.notification_channel NOT NULL,
  template        text,                            -- ex.: goal_reached, video_approved, commission_credited
  title           text,
  body            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  sent_at         timestamptz,
  read_at         timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only: sem updated_at (única exceção à convenção, documentada) e sem
-- UPDATE/DELETE para openrate_app (revogados na seção 9). Particionamento por
-- mês fica para migration futura, quando o volume justificar — o índice
-- (organization_id, created_at) cobre as consultas até lá. Os triggers de
-- auditoria por tabela também ficam para migration futura; no MVP quem grava
-- é a camada de serviço da API.
CREATE TABLE openrate.audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES openrate.organizations(id),  -- NULL = ação de plataforma
  user_id         uuid REFERENCES openrate.users(id) ON DELETE SET NULL,
  action          text NOT NULL,                   -- ex.: video.approved, payout.paid
  entity_type     text,
  entity_id       text,
  old_data        jsonb,
  new_data        jsonb,
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 6. Índices (FKs, organization_id em toda tabela tenant, unique parciais)
-- ----------------------------------------------------------------------------

-- multi-tenancy
CREATE INDEX idx_stores_org               ON openrate.stores (organization_id);
CREATE INDEX idx_users_org                ON openrate.users (organization_id);
CREATE INDEX idx_users_org_role           ON openrate.users (organization_id, role);
CREATE UNIQUE INDEX uq_users_email        ON openrate.users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_stores_store        ON openrate.user_stores (store_id);
CREATE INDEX idx_user_stores_org          ON openrate.user_stores (organization_id);

-- operação
CREATE INDEX idx_integrations_org         ON openrate.integrations (organization_id);
CREATE INDEX idx_integrations_store       ON openrate.integrations (store_id);

-- catálogo
CREATE INDEX idx_brands_org               ON openrate.brands (organization_id);
CREATE INDEX idx_categories_org           ON openrate.categories (organization_id);
CREATE INDEX idx_categories_parent        ON openrate.categories (parent_id);
CREATE INDEX idx_products_org             ON openrate.products (organization_id);
CREATE INDEX idx_products_store           ON openrate.products (store_id);
CREATE INDEX idx_products_brand           ON openrate.products (brand_id);
CREATE INDEX idx_products_category        ON openrate.products (category_id);
CREATE INDEX idx_products_scope           ON openrate.products (scope);
CREATE INDEX idx_products_integration     ON openrate.products (integration_id);
-- idempotência da importação de ERP
CREATE UNIQUE INDEX uq_products_integration_ext
  ON openrate.products (integration_id, external_id)
  WHERE integration_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_product_images_product   ON openrate.product_images (product_id);
CREATE INDEX idx_product_images_org       ON openrate.product_images (organization_id);
CREATE INDEX idx_product_variations_product ON openrate.product_variations (product_id);
CREATE INDEX idx_product_variations_org   ON openrate.product_variations (organization_id);
CREATE UNIQUE INDEX uq_product_variations_sku
  ON openrate.product_variations (product_id, sku)
  WHERE sku IS NOT NULL;
CREATE INDEX idx_store_inventory_org      ON openrate.store_inventory (organization_id);
CREATE INDEX idx_store_inventory_product  ON openrate.store_inventory (product_id);
CREATE INDEX idx_store_inventory_variation ON openrate.store_inventory (variation_id);

-- conteúdo
CREATE INDEX idx_video_types_org          ON openrate.video_types (organization_id);
CREATE INDEX idx_video_ideas_org          ON openrate.video_ideas (organization_id);
CREATE INDEX idx_video_ideas_product      ON openrate.video_ideas (product_id);
CREATE INDEX idx_video_ideas_type         ON openrate.video_ideas (video_type_id);
CREATE INDEX idx_video_ideas_batch        ON openrate.video_ideas (batch_id);
CREATE INDEX idx_videos_org               ON openrate.videos (organization_id);
CREATE INDEX idx_videos_status            ON openrate.videos (status);
CREATE INDEX idx_videos_org_status        ON openrate.videos (organization_id, status);
CREATE INDEX idx_videos_store             ON openrate.videos (store_id);
CREATE INDEX idx_videos_user_created      ON openrate.videos (user_id, created_at DESC);
CREATE INDEX idx_videos_product           ON openrate.videos (product_id);
CREATE INDEX idx_videos_idea              ON openrate.videos (video_idea_id);
CREATE INDEX idx_videos_approved_by       ON openrate.videos (approved_by);
CREATE INDEX idx_video_publications_org   ON openrate.video_publications (organization_id);
CREATE INDEX idx_video_publications_video ON openrate.video_publications (video_id);
CREATE INDEX idx_video_publications_platform_status
  ON openrate.video_publications (platform, status);
-- 1 publicação viva por (vídeo, plataforma); republicar exige remover/falhar a anterior
CREATE UNIQUE INDEX uq_video_publications_active
  ON openrate.video_publications (video_id, platform)
  WHERE status NOT IN ('failed','removed');
CREATE INDEX idx_affiliate_links_org      ON openrate.affiliate_links (organization_id);
CREATE INDEX idx_affiliate_links_store    ON openrate.affiliate_links (store_id);
CREATE INDEX idx_affiliate_links_user     ON openrate.affiliate_links (user_id);
CREATE INDEX idx_affiliate_links_product  ON openrate.affiliate_links (product_id);
CREATE INDEX idx_affiliate_links_publication ON openrate.affiliate_links (video_publication_id);
-- único TOTAL de propósito (ver COMMENT na coluna): short_code nunca é reciclado
CREATE UNIQUE INDEX uq_affiliate_links_short_code ON openrate.affiliate_links (short_code);

-- financeiro
CREATE INDEX idx_commission_rules_org      ON openrate.commission_rules (organization_id);
CREATE INDEX idx_commission_rules_store    ON openrate.commission_rules (store_id);
CREATE INDEX idx_commission_rules_product  ON openrate.commission_rules (product_id);
CREATE INDEX idx_commission_rules_category ON openrate.commission_rules (category_id);
CREATE INDEX idx_commission_rules_lookup   ON openrate.commission_rules (active, priority DESC);
CREATE INDEX idx_affiliate_sales_org       ON openrate.affiliate_sales (organization_id);
CREATE INDEX idx_affiliate_sales_org_occurred ON openrate.affiliate_sales (organization_id, occurred_at DESC);
CREATE INDEX idx_affiliate_sales_store     ON openrate.affiliate_sales (store_id);
CREATE INDEX idx_affiliate_sales_link      ON openrate.affiliate_sales (affiliate_link_id);
CREATE INDEX idx_affiliate_sales_user      ON openrate.affiliate_sales (user_id);
CREATE INDEX idx_affiliate_sales_product   ON openrate.affiliate_sales (product_id);
CREATE INDEX idx_affiliate_sales_status    ON openrate.affiliate_sales (status);
CREATE INDEX idx_payouts_org               ON openrate.payouts (organization_id);
CREATE INDEX idx_payouts_org_status        ON openrate.payouts (organization_id, status);
CREATE INDEX idx_payouts_user_status       ON openrate.payouts (user_id, status);
CREATE INDEX idx_payouts_approved_by       ON openrate.payouts (approved_by);
CREATE UNIQUE INDEX uq_payouts_asaas_transfer
  ON openrate.payouts (asaas_transfer_id)
  WHERE asaas_transfer_id IS NOT NULL;
CREATE INDEX idx_entries_org               ON openrate.commission_entries (organization_id);
CREATE INDEX idx_entries_org_status        ON openrate.commission_entries (organization_id, status);
CREATE INDEX idx_entries_sale              ON openrate.commission_entries (affiliate_sale_id);
CREATE INDEX idx_entries_rule              ON openrate.commission_entries (commission_rule_id);
CREATE INDEX idx_entries_user_status       ON openrate.commission_entries (user_id, status);
CREATE INDEX idx_entries_store             ON openrate.commission_entries (store_id);
CREATE INDEX idx_entries_payout            ON openrate.commission_entries (payout_id);
CREATE INDEX idx_entries_reversal          ON openrate.commission_entries (reversal_of);
-- fechamento: busca lançamentos payable com carência vencida
CREATE INDEX idx_entries_payable
  ON openrate.commission_entries (payable_at)
  WHERE status IN ('pending','payable');

-- engajamento
CREATE INDEX idx_goals_org                 ON openrate.goals (organization_id);
CREATE INDEX idx_goals_store               ON openrate.goals (store_id);
CREATE INDEX idx_goals_user                ON openrate.goals (user_id);
CREATE INDEX idx_achievements_org          ON openrate.achievements (organization_id);
CREATE INDEX idx_user_achievements_org     ON openrate.user_achievements (organization_id);
CREATE INDEX idx_user_achievements_achievement ON openrate.user_achievements (achievement_id);

-- CRM físico
CREATE INDEX idx_customers_org             ON openrate.customers (organization_id);
CREATE INDEX idx_customers_store           ON openrate.customers (store_id);
CREATE INDEX idx_customers_org_phone       ON openrate.customers (organization_id, phone);
CREATE UNIQUE INDEX uq_customers_org_ext
  ON openrate.customers (organization_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_store_sales_org           ON openrate.store_sales (organization_id);
CREATE INDEX idx_store_sales_store_occurred ON openrate.store_sales (store_id, occurred_at DESC);
CREATE INDEX idx_store_sales_customer      ON openrate.store_sales (customer_id);
CREATE INDEX idx_store_sales_user          ON openrate.store_sales (user_id);
CREATE UNIQUE INDEX uq_store_sales_store_ext
  ON openrate.store_sales (store_id, external_id)
  WHERE external_id IS NOT NULL;

-- operação
CREATE INDEX idx_notifications_org         ON openrate.notifications (organization_id);
CREATE INDEX idx_notifications_user_created ON openrate.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_pending     ON openrate.notifications (status) WHERE status = 'pending';
CREATE INDEX idx_audit_log_org_created     ON openrate.audit_log (organization_id, created_at DESC);
CREATE INDEX idx_audit_log_entity          ON openrate.audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_user            ON openrate.audit_log (user_id);

-- ----------------------------------------------------------------------------
-- 7. Trigger de updated_at em TODAS as tabelas que têm a coluna
--    (audit_log fica de fora automaticamente: é append-only, sem updated_at)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'openrate'
      AND c.column_name  = 'updated_at'
      AND tb.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON openrate.%I
         FOR EACH ROW EXECUTE FUNCTION openrate.set_updated_at()',
      t.table_name, t.table_name
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. View: progresso de meta diária por usuário
--    security_invoker: a view respeita o RLS das tabelas base para quem consulta.
--    Datas resolvidas em America/Sao_Paulo (mesmo TZ dos jobs de fechamento).
-- ----------------------------------------------------------------------------
CREATE VIEW openrate.v_goal_progress_daily
WITH (security_invoker = true) AS
WITH ref AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS ref_date
),
goal_users AS (
  -- expande cada meta diária ativa para os usuários aos quais ela se aplica:
  -- meta individual (user_id), meta de loja (store_id) ou meta da org inteira
  SELECT
    g.id              AS goal_id,
    g.organization_id,
    g.store_id,
    g.target_videos,
    u.id              AS user_id
  FROM openrate.goals g
  CROSS JOIN ref
  JOIN openrate.users u
    ON u.organization_id = g.organization_id
   AND u.active
   AND u.deleted_at IS NULL
   AND (
        (g.user_id IS NOT NULL AND u.id = g.user_id)
     OR (g.user_id IS NULL AND u.role = 'attendant')
   )
   AND (
        g.store_id IS NULL
     OR EXISTS (
          SELECT 1 FROM openrate.user_stores us
          WHERE us.user_id = u.id AND us.store_id = g.store_id
        )
   )
  WHERE g.period = 'daily'
    AND g.active
    AND (g.valid_from  IS NULL OR g.valid_from  <= ref.ref_date)
    AND (g.valid_until IS NULL OR g.valid_until >= ref.ref_date)
)
SELECT
  gu.organization_id,
  gu.goal_id,
  gu.user_id,
  r.ref_date,
  gu.target_videos,
  COUNT(DISTINCT v.id) FILTER (
    WHERE v.uploaded_at IS NOT NULL
      AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
  ) AS videos_submitted,
  COUNT(DISTINCT v.id) FILTER (
    WHERE v.approved_at IS NOT NULL
      AND (v.approved_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
  ) AS videos_approved,
  COUNT(DISTINCT v.id) FILTER (
    WHERE v.uploaded_at IS NOT NULL
      AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
  ) >= gu.target_videos AS goal_met,
  ROUND(
    LEAST(
      100.0 * COUNT(DISTINCT v.id) FILTER (
        WHERE v.uploaded_at IS NOT NULL
          AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      ) / NULLIF(gu.target_videos, 0),
      100.0
    ), 1
  ) AS progress_pct
FROM goal_users gu
CROSS JOIN ref r
LEFT JOIN openrate.videos v
  ON v.user_id = gu.user_id
 AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
 AND (
      (v.uploaded_at IS NOT NULL AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date)
   OR (v.approved_at IS NOT NULL AND (v.approved_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date)
 )
GROUP BY gu.organization_id, gu.goal_id, gu.user_id, r.ref_date, gu.target_videos;

COMMENT ON VIEW openrate.v_goal_progress_daily IS
  'Progresso da meta diária por usuário: vídeos enviados/aprovados hoje vs target_videos. security_invoker: herda o RLS das tabelas base.';

-- ----------------------------------------------------------------------------
-- 9. RLS — habilitado (e FORÇADO) em toda tabela tenant
--    Padrão em todas as tabelas com organization_id:
--      * tenant_isolation: organization_id = openrate.current_org_id()
--      * super_admin_all:  bypass para role de negócio super_admin (claim)
--    Policies são PERMISSIVAS (OR entre si). RLS aqui é isolamento POR ORG
--    (defesa em profundidade); autorização fina (attendant vê só o que é seu
--    etc.) é responsabilidade da camada de serviço da API.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'openrate'
      AND c.column_name  = 'organization_id'
      AND tb.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE openrate.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    -- FORCE: nem o dono das tabelas escapa do RLS (roles com BYPASSRLS/superuser sim)
    EXECUTE format('ALTER TABLE openrate.%I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON openrate.%I
         FOR ALL
         USING (organization_id = openrate.current_org_id())
         WITH CHECK (organization_id = openrate.current_org_id())',
      t.table_name
    );
    EXECUTE format(
      'CREATE POLICY super_admin_all ON openrate.%I
         FOR ALL
         USING (openrate.is_super_admin())
         WITH CHECK (openrate.is_super_admin())',
      t.table_name
    );
  END LOOP;
END $$;

-- organizations não tem organization_id (o tenant é a própria linha)
ALTER TABLE openrate.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE openrate.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_self_read ON openrate.organizations
  FOR SELECT USING (id = openrate.current_org_id());
CREATE POLICY org_self_update ON openrate.organizations
  FOR UPDATE USING (id = openrate.current_org_id())
  WITH CHECK (id = openrate.current_org_id());
CREATE POLICY super_admin_all ON openrate.organizations
  FOR ALL USING (openrate.is_super_admin())
  WITH CHECK (openrate.is_super_admin());

-- Leitura do catálogo/config GLOBAL da plataforma (organization_id IS NULL)
-- por qualquer usuário AUTENTICADO de qualquer tenant (spec 2.6). A exigência
-- de claims presentes impede leitura em conexão sem set_config/JWT.
CREATE POLICY platform_read ON openrate.products
  FOR SELECT USING (organization_id IS NULL AND scope = 'platform'
                    AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.product_images
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.product_variations
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.brands
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.categories
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.video_types
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.achievements
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);
CREATE POLICY platform_read ON openrate.commission_rules
  FOR SELECT USING (organization_id IS NULL AND openrate.jwt_claims() IS NOT NULL);

-- usuário sempre enxerga o próprio registro (mesmo antes do claim org_id existir)
CREATE POLICY self_read ON openrate.users
  FOR SELECT USING (id = openrate.current_user_id());

-- ----------------------------------------------------------------------------
-- 10. GRANTs para a role de aplicação (openrate_app)
--     A role NÃO é dona de nada; RLS se aplica integralmente a ela.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA openrate TO openrate_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA openrate TO openrate_app;
-- audit_log é append-only para a aplicação:
REVOKE UPDATE, DELETE ON openrate.audit_log FROM openrate_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA openrate TO openrate_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA openrate TO openrate_app;

-- Objetos criados por migrations futuras (rodando com esta mesma role dona)
-- já nascem com os grants corretos:
ALTER DEFAULT PRIVILEGES IN SCHEMA openrate
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openrate_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA openrate
  GRANT USAGE, SELECT ON SEQUENCES TO openrate_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA openrate
  GRANT EXECUTE ON FUNCTIONS TO openrate_app;

-- ----------------------------------------------------------------------------
-- 11. Asserção de cobertura de RLS (invariante verificada, não convenção)
--     Falha a migration se QUALQUER tabela base do schema openrate ficar sem
--     ENABLE + FORCE ROW LEVEL SECURITY ou sem ao menos uma policy. Transforma
--     "toda tabela tenant tem RLS" de convenção implícita em garantia checada —
--     uma tabela futura sem organization_id (que hoje escaparia do bloco
--     dinâmico) quebra o deploy em vez de virar um furo silencioso de tenancy.
--     Allowlist: tabelas intencionalmente sem RLS entram em except_tables.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  except_tables text[] := ARRAY[]::text[];  -- nenhuma exceção hoje
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'openrate'
    AND c.relkind = 'r'
    AND c.relname <> ALL (except_tables)
    AND (
      c.relrowsecurity = false
      OR c.relforcerowsecurity = false
      OR NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'openrate' AND p.tablename = c.relname
      )
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas sem RLS+FORCE+policy no schema openrate: %', bad;
  END IF;
END $$;

-- ============================================================================
-- Fim da migration 0001_init
-- ============================================================================

-- migrate:down
-- Reverte a migration inicial removendo o schema inteiro. Só destrói objetos do
-- schema "openrate" — não toca em auth/storage/public nem em outros produtos.
-- As roles openrate_owner/openrate_app são criadas fora da migration (runbook),
-- então NÃO são removidas aqui. Este bloco NÃO deve ser executado via psql -f
-- do arquivo inteiro (ver cabeçalho): é para o `dbmate down`.
DROP SCHEMA IF EXISTS openrate CASCADE;
