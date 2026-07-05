-- ============================================================================
-- OpenRate — Migration 0001_init (CONSOLIDADA)
-- Schema dedicado "openrate" no Postgres compartilhado.
--
-- Esta é a migration inicial ÚNICA e autoritativa: consolida (squash) as antigas
-- 0001..0007 num só arquivo. NÃO há dados de produção — o resultado de aplicar
-- este arquivo numa base limpa é EXATAMENTE o mesmo schema de aplicar 0001→0007
-- em ordem. Deltas foram DOBRADOS nas definições limpas (sem guardas de ALTER):
--   * 0002 — resolver público de link de afiliado (função SECURITY DEFINER +
--            policy só-do-owner em affiliate_links);
--   * 0003 — seed dos video_types GLOBAIS (organization_id NULL);
--   * 0004 — auth própria (id auto-gerado + password_hash, índice CI, policy
--            só-do-owner em users, funções auth_find_user/bootstrap_super_admin);
--   * 0005 — openrate.jwt_claims() SEM o fallback antigo para auth.jwt();
--   * 0006 — enums novos + colunas de cadastro (organizations/stores/users/
--            products/product_images/video_types/customers/videos/payouts/
--            commission_rules); coluna customers.cpf REMOVIDA;
--   * 0007 — metas genéricas: goals.target_videos/target_sales_amount REMOVIDAS,
--            goals.metric/target_value ADICIONADAS; view v_goal_progress_daily
--            reescrita para medir a métrica escolhida.
--
-- PRÉ-REQUISITOS (runbook de provisionamento, FORA desta migration):
--   1. Roles openrate_owner (dona) e openrate_app (runtime) já criadas.
--        openrate_app: LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS.
--   2. Schema "openrate" já criado (CREATE SCHEMA openrate AUTHORIZATION
--      openrate_owner) pelo deploy — esta migration NÃO cria schema nem roles.
--   3. Esta migration roda com a role DONA (openrate_owner) — NUNCA com
--      openrate_app. A role de aplicação não é dona de nenhum objeto, justamente
--      para o RLS valer para ela.
--
-- COMO APLICAR:
--   * dbmate (nativo):  dbmate --migrations-table openrate.schema_migrations up
--   * psql direto (sem o bloco down): cortar do marcador down em diante com o
--     sed ANCORADO em inicio de linha (^) para nao casar com esta documentacao —
--       sed '/^-- migrate:down/,$d' 0001_init.sql | psql "$URL" --single-transaction -v ON_ERROR_STOP=1
--     (NUNCA rodar o arquivo inteiro no psql, senao o bloco down ao final apaga
--      os objetos recem-criados)
--
-- GARANTIAS:
--   - Nenhum objeto criado fora do schema "openrate" (exceto a extensão
--     pgcrypto, que já existe no schema "extensions").
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
-- MODELO DE CONFIANÇA (leia antes de mexer no RLS):
--   O RLS aqui é ISOLAMENTO DE CONSULTA (defense-in-depth), NÃO uma fronteira
--   contra a própria role de runtime. openrate_app conecta direto e todo o RLS
--   deriva de current_setting('request.jwt.claims'); EXECUTE em set_config é
--   PUBLIC. Logo, QUALQUER SQL arbitrário rodando como openrate_app (credencial
--   vazada ou UMA injeção de SQL) pode forjar
--   {"app_metadata":{"role":"super_admin"}} e ler/gravar qualquer tenant.
--   A FRONTEIRA REAL é a API: valida o JWT (HS256) e só então injeta os claims
--   com set_config(..., is_local=TRUE) DENTRO da transação do request (ver
--   apps/api/src/common/pg.service.ts — nunca is_local=false, senão o claim
--   vaza no pool p/ o próximo request de outro tenant). Toda construção de query
--   deve ser parametrizada. A role de migração openrate_owner é DONA das tabelas
--   e, mesmo com FORCE RLS, pode desabilitar RLS/dropar policies: sua senha
--   (deploy/.env, root-only) é tão sensível quanto um bypass total — mantenha-a
--   de alta entropia e NUNCA a compartilhe com a role de runtime.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. Schema e search_path
--    O schema normalmente já é criado pelo runbook/deploy (como postgres,
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
--    pgp_sym_encrypt/pgp_sym_decrypt. Normalmente JÁ VEM instalada no schema
--    "extensions"; o bloco abaixo só garante idempotência e cobre ambientes de
--    teste (Postgres vanilla, onde cai no schema public).
--    gen_random_uuid() é nativo do Postgres >= 13 (não depende de pgcrypto).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Se pgcrypto já existe, NÃO chamar CREATE EXTENSION: ela exige privilégio de
  -- superusuário/CREATE no database, que a role de migração (openrate_owner,
  -- NOSUPERUSER) não tem. Só cria em Postgres vanilla (teste, como superuser).
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
--    DB limpo → CREATE TYPE simples, sem guardas. Inclui os enums originais
--    (0001), os novos de cadastro (0006) e o de métrica de meta (0007).
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

-- Enums novos de cadastro (dobrados da 0006) ---------------------------------
CREATE TYPE openrate.org_plan AS ENUM ('free', 'pro', 'rede');
CREATE TYPE openrate.org_status AS ENUM ('active', 'suspended', 'churned');
CREATE TYPE openrate.product_type AS ENUM ('simple', 'kit', 'variation_parent');
CREATE TYPE openrate.product_unit AS ENUM ('UN', 'KG', 'CX', 'PCT');
CREATE TYPE openrate.commission_base AS ENUM ('affiliate_payout', 'gross_sale');

-- Enum de métrica de meta (dobrado da 0007) ----------------------------------
CREATE TYPE openrate.goal_metric AS ENUM (
  'videos_recorded',
  'videos_published',
  'views',
  'affiliate_revenue'
);

-- ----------------------------------------------------------------------------
-- 4. Funções auxiliares (JWT claims + updated_at + resolver + auth própria)
-- ----------------------------------------------------------------------------

-- Lê os claims do JWT de current_setting('request.jwt.claims'), populado pela
-- API via set_config('request.jwt.claims', <json>, true) em conexão direta.
-- (Versão FINAL da 0005: SEM o antigo fallback para auth.jwt() — a auth é 100%
-- própria da API; esta é a única fonte de claims.)
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
  RETURN claims;
END;
$$;

COMMENT ON FUNCTION openrate.jwt_claims() IS
  'Claims do JWT lidos de request.jwt.claims (injetados pela API via set_config por transação).';

-- org_id do tenant corrente. Aceita o claim tanto em app_metadata.org_id
-- quanto no topo do JSON (formato simplificado).
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

-- sub do JWT = id do usuário (openrate.users.id)
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
-- app_metadata.role — nunca do claim top-level "role" (que costuma ser a
-- role do Postgres, não a role do produto).
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
-- 5. Tabelas (ordem respeita dependências de FK). As colunas dobradas da 0006/
--    0007 aparecem AO FINAL de cada tabela, na ordem em que os ALTER as
--    adicionavam (para casar o layout físico/attnum com a base migrada); as
--    colunas removidas (customers.cpf; goals.target_videos/target_sales_amount)
--    simplesmente NÃO são declaradas.
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
  -- dobrado da 0006: nome fantasia + plano/status da assinatura
  trade_name    text,
  plan          openrate.org_plan   NOT NULL DEFAULT 'free',
  status        openrate.org_status NOT NULL DEFAULT 'active',
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
  -- dobrado da 0006: contato da loja
  phone           text,
  whatsapp        text,
  CONSTRAINT uq_stores_org_slug UNIQUE (organization_id, slug)
);
COMMENT ON TABLE openrate.stores IS 'Loja física pertencente a uma organization.';

-- Usuários do OpenRate. id auto-gerado (dobrado da 0004: DEFAULT gen_random_uuid()).
-- Mantido em schema próprio, sem FK cross-schema para nenhum schema de auth externo:
--   1) FK cross-schema criaria dependência que dificulta upgrades e backup/restore;
--   2) backup/restore por schema (pg_dump -n openrate) ficaria irrestaurável
--      isoladamente com FK apontando para fora do schema.
--   A auth é própria da API (senha em password_hash; ver funções auth na seção 4).
CREATE TABLE openrate.users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- 0004
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
  -- dobrado da 0004: hash da senha (scrypt, calculado no Node)
  password_hash           text,
  -- dobrado da 0006: troca de senha obrigatória no 1º acesso
  must_change_password    boolean NOT NULL DEFAULT false,
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
  -- dobrado da 0006: identificação, fiscal, preços, descrição, SEO, logística
  model                   text,
  product_type            openrate.product_type NOT NULL DEFAULT 'simple',
  unit                    openrate.product_unit,
  cost_price              numeric(14,2) CHECK (cost_price IS NULL OR cost_price >= 0),
  short_description       text,
  tags                    text[] NOT NULL DEFAULT '{}',
  seo_title               text,
  seo_description         text,
  institutional_video_url text,
  ncm                     text,
  cest                    text,
  fiscal_origin           text,
  weight_gross_kg         numeric(10,3),
  weight_net_kg           numeric(10,3),
  height_cm               numeric(10,2),
  width_cm                numeric(10,2),
  length_cm               numeric(10,2),
  items_per_box           integer CHECK (items_per_box IS NULL OR items_per_box > 0),
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
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- dobrado da 0006: imagem principal
  is_primary      boolean NOT NULL DEFAULT false
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
  -- dobrado da 0006: ícone e esqueleto de roteiro (editor de passos)
  icon                     text,
  script_skeleton          jsonb NOT NULL DEFAULT '[]',
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
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- dobrado da 0006: resultado do ffprobe (quality gate do worker)
  quality_check    jsonb
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
  -- dobrado da 0006: base do rateio (comissão de afiliado x valor bruto)
  calc_base       openrate.commission_base NOT NULL DEFAULT 'affiliate_payout',
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
  -- Idempotência de importação POR ORG: a mesma venda nunca entra duas vezes na
  -- mesma org, mas orgs distintas podem ter external_id iguais na plataforma.
  CONSTRAINT uq_affiliate_sales_org_platform_ext UNIQUE (organization_id, platform, external_id)
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
  -- dobrado da 0006: chave do recibo (PDF) no MinIO
  receipt_key       text,
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

-- goals: metas genéricas (dobrado da 0007). Em vez dos antigos target_videos +
-- target_sales_amount (REMOVIDOS), a meta escolhe UMA métrica (metric) e um
-- valor alvo (target_value); a view v_goal_progress_daily mede a métrica.
CREATE TABLE openrate.goals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id            uuid REFERENCES openrate.stores(id),   -- NULL = meta da org inteira
  user_id             uuid REFERENCES openrate.users(id),    -- NULL = vale para todos os attendants do escopo
  name                text NOT NULL,
  period              openrate.goal_period NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  valid_from          date,
  valid_until         date,
  created_by          uuid REFERENCES openrate.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- dobrado da 0007: métrica escolhida + valor alvo
  metric              openrate.goal_metric NOT NULL DEFAULT 'videos_recorded',
  target_value        numeric(14,2) NOT NULL DEFAULT 0
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

-- customers: CRM completo. A antiga coluna 'cpf' foi REMOVIDA (0006) — o
-- documento (PF/PJ) agora vive em 'document'. Colunas de contato/endereço/
-- LGPD dobradas da 0006 ao final.
CREATE TABLE openrate.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES openrate.organizations(id),
  store_id        uuid REFERENCES openrate.stores(id),
  external_id     text,                            -- id do cliente no ERP
  name            text NOT NULL,
  phone           text,
  email           text,
  birthdate       date,
  tags            text[] NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- dobrado da 0006: contato, gênero, endereço, origem, consentimento LGPD e
  -- documento (PF/PJ) que substitui o antigo 'cpf'
  whatsapp        text,
  gender          text,
  address         jsonb NOT NULL DEFAULT '{}',
  origin          text,
  lgpd_consent    boolean NOT NULL DEFAULT false,
  document        text
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
-- UPDATE/DELETE para openrate_app (revogados na seção 10). Particionamento por
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
-- dobrado da 0004: segundo índice CI de e-mail (mesma definição, nome distinto)
CREATE UNIQUE INDEX uq_users_email_ci     ON openrate.users (lower(email)) WHERE deleted_at IS NULL;
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
-- 6b. Auth própria da API (dobrado da 0004) — funções SECURITY DEFINER que
--     rodam como o DONO (openrate_owner) para login/bootstrap SEM claim de
--     tenant. A policy só-para-o-owner que as habilita fica na seção 9 (RLS).
--     click_affiliate_link (dobrado da 0002) fica logo abaixo.
-- ----------------------------------------------------------------------------

-- Lookup de login: retorna o hash + o contexto do tenant p/ a API validar a senha
-- (scrypt, no Node) e emitir o JWT. Só resolve por e-mail EXATO (case-insensitive).
CREATE OR REPLACE FUNCTION openrate.auth_find_user(p_email text)
RETURNS TABLE(
  id uuid, email text, password_hash text,
  organization_id uuid, store_id uuid, role openrate.user_role,
  full_name text, active boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = openrate AS $$
  SELECT u.id, u.email, u.password_hash, u.organization_id,
         -- users não tem store_id; a loja do usuário vem de user_stores (junção).
         (SELECT us.store_id FROM openrate.user_stores us WHERE us.user_id = u.id LIMIT 1) AS store_id,
         u.role, u.full_name, u.active
  FROM openrate.users u
  WHERE lower(u.email) = lower(p_email) AND u.deleted_at IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION openrate.auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.auth_find_user(text) TO openrate_app;

-- Bootstrap do PRIMEIRO super_admin (organization_id NULL). AUTO-DESABILITA: só cria
-- se ainda não houver nenhum super_admin — seguro para expor num endpoint público de
-- primeiro acesso (POST /v1/auth/bootstrap). Depois disso sempre falha (23505).
CREATE OR REPLACE FUNCTION openrate.bootstrap_super_admin(
  p_email text, p_full_name text, p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = openrate AS $$
DECLARE new_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM openrate.users WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'super_admin ja existe' USING errcode = 'unique_violation';
  END IF;
  INSERT INTO openrate.users (organization_id, role, email, full_name, password_hash)
  VALUES (NULL, 'super_admin', p_email, p_full_name, p_password_hash)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION openrate.bootstrap_super_admin(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.bootstrap_super_admin(text, text, text) TO openrate_app;

-- Resolver do redirect PÚBLICO de link de afiliado (/r/:code) (dobrado da 0002).
-- SECURITY DEFINER: roda como openrate_owner e, via a policy resolver_owner_all
-- (seção 9), resolve o short_code EXATO cross-tenant mesmo com FORCE RLS ativo.
CREATE OR REPLACE FUNCTION openrate.click_affiliate_link(p_code text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = openrate
AS $$
  UPDATE openrate.affiliate_links
     SET clicks_count = clicks_count + 1
   WHERE short_code = p_code AND active = true
  RETURNING destination_url;
$$;
-- Só a role de runtime pode executar; ninguém mais.
REVOKE ALL ON FUNCTION openrate.click_affiliate_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.click_affiliate_link(text) TO openrate_app;

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
-- 8. View: progresso de meta diária por usuário (versão FINAL da 0007).
--    security_invoker: a view respeita o RLS das tabelas base para quem consulta.
--    Mede a MÉTRICA escolhida (metric) contra target_value; datas resolvidas em
--    America/Sao_Paulo (mesmo TZ dos jobs de fechamento). current_value via
--    subquery correlacionada por métrica (evita fan-out de JOINs).
-- ----------------------------------------------------------------------------
CREATE VIEW openrate.v_goal_progress_daily
WITH (security_invoker = true) AS
WITH ref AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS ref_date
),
goal_users AS (
  SELECT
    g.id              AS goal_id,
    g.organization_id,
    g.store_id,
    g.metric,
    g.target_value,
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
),
progress AS (
  SELECT
    gu.organization_id,
    gu.goal_id,
    gu.user_id,
    r.ref_date,
    gu.metric,
    gu.target_value,
    CASE gu.metric
      WHEN 'videos_recorded' THEN (
        SELECT count(*)::numeric FROM openrate.videos v
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND v.uploaded_at IS NOT NULL
          AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'videos_published' THEN (
        SELECT count(*)::numeric
        FROM openrate.video_publications p
        JOIN openrate.videos v ON v.id = p.video_id
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND p.published_at IS NOT NULL
          AND (p.published_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'views' THEN (
        SELECT COALESCE(SUM(p.views_count), 0)::numeric
        FROM openrate.video_publications p
        JOIN openrate.videos v ON v.id = p.video_id
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND p.published_at IS NOT NULL
          AND (p.published_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'affiliate_revenue' THEN (
        SELECT COALESCE(SUM(s.commissionable_amount), 0)::numeric
        FROM openrate.affiliate_sales s
        WHERE s.user_id = gu.user_id
          AND (gu.store_id IS NULL OR s.store_id = gu.store_id)
          AND s.status = 'confirmed'
          AND (s.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
    END AS current_value
  FROM goal_users gu
  CROSS JOIN ref r
)
SELECT
  organization_id,
  goal_id,
  user_id,
  ref_date,
  metric,
  target_value,
  current_value,
  (current_value >= target_value) AS goal_met,
  ROUND(LEAST(100.0 * current_value / NULLIF(target_value, 0), 100.0), 1) AS progress_pct
FROM progress;

COMMENT ON VIEW openrate.v_goal_progress_daily IS
  'Progresso da meta diária por usuário conforme a métrica (videos_recorded/videos_published/views/affiliate_revenue) vs target_value. security_invoker: herda o RLS das tabelas base.';

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

-- Policy só-para-o-owner em users (dobrado da 0004): habilita as funções
-- SECURITY DEFINER de auth (auth_find_user/bootstrap_super_admin), que rodam
-- como openrate_owner e precisam ler/gravar usuários cross-tenant no login/
-- bootstrap (sem claim). openrate_app continua restrita às policies de tenant.
CREATE POLICY auth_owner_all ON openrate.users
  FOR ALL TO openrate_owner
  USING (true) WITH CHECK (true);

-- Policy só-para-o-owner em affiliate_links (dobrado da 0002): habilita a função
-- SECURITY DEFINER click_affiliate_link a resolver o link no redirect público
-- cross-tenant, mantendo FORCE RLS ativo. openrate_app permanece restrita à sua
-- policy tenant_isolation (esta policy do owner NÃO se aplica a ela).
CREATE POLICY resolver_owner_all ON openrate.affiliate_links
  FOR ALL TO openrate_owner
  USING (true) WITH CHECK (true);

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
-- 11. Seed dos tipos de vídeo GLOBAIS (organization_id NULL) (dobrado da 0003)
--     Lidos por qualquer org (policy platform_read) pelo job ai-script-generation.
--     Inserir linhas org-null é bloqueado pelo FORCE RLS (tenant_isolation exige
--     organization_id = claim, e sem claim current_org_id() é NULL). Como o dono
--     não é superuser, suspendemos o FORCE só durante o seed e o restauramos em
--     seguida — a tabela nunca fica sem FORCE em repouso (invariante checada na
--     seção 12).
-- ----------------------------------------------------------------------------
ALTER TABLE openrate.video_types NO FORCE ROW LEVEL SECURITY;

INSERT INTO openrate.video_types (organization_id, name, slug, description, prompt_template, default_duration_seconds)
VALUES
  (NULL, 'Unboxing', 'unboxing', 'Abertura do produto com reações e destaques.',
   'Mostre a embalagem, abra na frente da câmera, destaque 3 diferenciais e feche com CTA.', 45),
  (NULL, 'Review', 'review', 'Avaliação honesta com prós e um contra.',
   'Apresente o produto, liste 3 prós e 1 ponto de atenção, dê uma nota e CTA.', 60),
  (NULL, 'Antes e Depois', 'antes-depois', 'Transformação/resultado do uso do produto.',
   'Mostre o antes, aplique/use o produto, revele o depois e CTA.', 30),
  (NULL, 'Demonstração', 'demonstracao', 'Produto em uso real, passo a passo.',
   'Explique para que serve, demonstre o uso em 3 passos e CTA.', 45),
  (NULL, 'Tutorial', 'tutorial', 'Ensina a usar/aplicar o produto.',
   'Liste o que é preciso, ensine em passos numerados e feche com dica extra + CTA.', 60)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- …e restaura o FORCE imediatamente (a tabela nunca fica sem FORCE em repouso).
ALTER TABLE openrate.video_types FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 12. Asserção de cobertura de RLS (invariante verificada, não convenção)
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
-- Fim da migration 0001_init (consolidada)
-- ============================================================================

-- migrate:down
-- Teardown seguro: derruba SOMENTE os objetos criados por esta migration, em
-- ordem reversa de dependência. NÃO usa DROP SCHEMA (o schema "openrate" é
-- criado FORA da migration, pelo deploy) nem remove as roles openrate_owner/
-- openrate_app (também externas). Este bloco NÃO deve ser executado via psql -f
-- do arquivo inteiro (ver cabeçalho): é para o `dbmate down`.
SET search_path TO openrate, public;

-- View
DROP VIEW IF EXISTS openrate.v_goal_progress_daily;

-- Tabelas (CASCADE remove policies, triggers, índices e FKs dependentes)
DROP TABLE IF EXISTS openrate.audit_log            CASCADE;
DROP TABLE IF EXISTS openrate.notifications        CASCADE;
DROP TABLE IF EXISTS openrate.store_sales          CASCADE;
DROP TABLE IF EXISTS openrate.customers            CASCADE;
DROP TABLE IF EXISTS openrate.user_achievements    CASCADE;
DROP TABLE IF EXISTS openrate.achievements         CASCADE;
DROP TABLE IF EXISTS openrate.goals                CASCADE;
DROP TABLE IF EXISTS openrate.commission_entries   CASCADE;
DROP TABLE IF EXISTS openrate.payouts              CASCADE;
DROP TABLE IF EXISTS openrate.affiliate_sales      CASCADE;
DROP TABLE IF EXISTS openrate.commission_rules     CASCADE;
DROP TABLE IF EXISTS openrate.affiliate_links      CASCADE;
DROP TABLE IF EXISTS openrate.video_publications   CASCADE;
DROP TABLE IF EXISTS openrate.videos               CASCADE;
DROP TABLE IF EXISTS openrate.video_ideas          CASCADE;
DROP TABLE IF EXISTS openrate.video_types          CASCADE;
DROP TABLE IF EXISTS openrate.store_inventory      CASCADE;
DROP TABLE IF EXISTS openrate.product_variations   CASCADE;
DROP TABLE IF EXISTS openrate.product_images       CASCADE;
DROP TABLE IF EXISTS openrate.products             CASCADE;
DROP TABLE IF EXISTS openrate.categories           CASCADE;
DROP TABLE IF EXISTS openrate.brands               CASCADE;
DROP TABLE IF EXISTS openrate.integrations         CASCADE;
DROP TABLE IF EXISTS openrate.user_stores          CASCADE;
DROP TABLE IF EXISTS openrate.users                CASCADE;
DROP TABLE IF EXISTS openrate.stores               CASCADE;
DROP TABLE IF EXISTS openrate.organizations        CASCADE;

-- Funções
DROP FUNCTION IF EXISTS openrate.click_affiliate_link(text);
DROP FUNCTION IF EXISTS openrate.bootstrap_super_admin(text, text, text);
DROP FUNCTION IF EXISTS openrate.auth_find_user(text);
DROP FUNCTION IF EXISTS openrate.set_updated_at();
DROP FUNCTION IF EXISTS openrate.is_super_admin();
DROP FUNCTION IF EXISTS openrate.current_user_role();
DROP FUNCTION IF EXISTS openrate.current_user_id();
DROP FUNCTION IF EXISTS openrate.current_org_id();
DROP FUNCTION IF EXISTS openrate.jwt_claims();

-- Tipos ENUM
DROP TYPE IF EXISTS openrate.goal_metric;
DROP TYPE IF EXISTS openrate.commission_base;
DROP TYPE IF EXISTS openrate.product_unit;
DROP TYPE IF EXISTS openrate.product_type;
DROP TYPE IF EXISTS openrate.org_status;
DROP TYPE IF EXISTS openrate.org_plan;
DROP TYPE IF EXISTS openrate.commission_beneficiary;
DROP TYPE IF EXISTS openrate.notification_channel;
DROP TYPE IF EXISTS openrate.integration_provider;
DROP TYPE IF EXISTS openrate.goal_period;
DROP TYPE IF EXISTS openrate.payout_status;
DROP TYPE IF EXISTS openrate.commission_entry_status;
DROP TYPE IF EXISTS openrate.sale_status;
DROP TYPE IF EXISTS openrate.publication_status;
DROP TYPE IF EXISTS openrate.publication_platform;
DROP TYPE IF EXISTS openrate.video_status;
DROP TYPE IF EXISTS openrate.product_origin;
DROP TYPE IF EXISTS openrate.product_scope;
DROP TYPE IF EXISTS openrate.user_role;
