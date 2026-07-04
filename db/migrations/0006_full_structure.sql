-- migrate:up
-- ============================================================================
-- OpenRate — Migration 0006_full_structure
--
-- Estrutura funcional completa dos cadastros (org, loja, usuário, produto,
-- catálogo, tipos de vídeo, cliente) + campos de vídeo/payout/comissão.
-- Aditiva e idempotente: o banco está VAZIO (sem migração de dados) e o
-- first-up.sh reaplica esta migration em toda execução.
--
-- METAS ficam de fora (migration 0007 / task T2 — refatoram a view
-- v_goal_progress_daily e o módulo).
--
-- ⚠️  APLICAR COMO openrate_owner CONECTANDO DIRETO (sem SET ROLE; o supautils do
--     container do banco encerra a conexão em SET ROLE). O first-up.sh conecta via TCP+senha.
-- ============================================================================

SET search_path TO openrate, public;

-- ---------------------------------------------------------------------------
-- Enums novos (CREATE TYPE não tem IF NOT EXISTS; guardamos em DO para reexecução)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_plan' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.org_plan AS ENUM ('free', 'pro', 'rede');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.org_status AS ENUM ('active', 'suspended', 'churned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_type' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.product_type AS ENUM ('simple', 'kit', 'variation_parent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_unit' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.product_unit AS ENUM ('UN', 'KG', 'CX', 'PCT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_base' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.commission_base AS ENUM ('affiliate_payout', 'gross_sale');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- organizations — plano e status de assinatura + nome fantasia
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.organizations
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS plan   openrate.org_plan   NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS status openrate.org_status NOT NULL DEFAULT 'active';

-- ---------------------------------------------------------------------------
-- stores — contato (o shape do endereço jsonb fica no DTO — T3)
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.stores
  ADD COLUMN IF NOT EXISTS phone    text,
  ADD COLUMN IF NOT EXISTS whatsapp text;

-- ---------------------------------------------------------------------------
-- users — troca de senha obrigatória no 1º acesso
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- products — identificação, fiscal, preços, descrição, SEO, logística
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.products
  ADD COLUMN IF NOT EXISTS model                   text,
  ADD COLUMN IF NOT EXISTS product_type            openrate.product_type NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS unit                    openrate.product_unit,
  ADD COLUMN IF NOT EXISTS cost_price              numeric(14,2) CHECK (cost_price IS NULL OR cost_price >= 0),
  ADD COLUMN IF NOT EXISTS short_description       text,
  ADD COLUMN IF NOT EXISTS tags                    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seo_title               text,
  ADD COLUMN IF NOT EXISTS seo_description         text,
  ADD COLUMN IF NOT EXISTS institutional_video_url text,
  ADD COLUMN IF NOT EXISTS ncm                     text,
  ADD COLUMN IF NOT EXISTS cest                    text,
  ADD COLUMN IF NOT EXISTS fiscal_origin           text,
  ADD COLUMN IF NOT EXISTS weight_gross_kg         numeric(10,3),
  ADD COLUMN IF NOT EXISTS weight_net_kg           numeric(10,3),
  ADD COLUMN IF NOT EXISTS height_cm               numeric(10,2),
  ADD COLUMN IF NOT EXISTS width_cm                numeric(10,2),
  ADD COLUMN IF NOT EXISTS length_cm               numeric(10,2),
  ADD COLUMN IF NOT EXISTS items_per_box           integer CHECK (items_per_box IS NULL OR items_per_box > 0);

-- ---------------------------------------------------------------------------
-- product_images — imagem principal
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.product_images
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- video_types — ícone e esqueleto de roteiro (editor de passos)
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.video_types
  ADD COLUMN IF NOT EXISTS icon            text,
  ADD COLUMN IF NOT EXISTS script_skeleton jsonb NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------------
-- customers — CRM completo. 'document' (PF/PJ) substitui o antigo 'cpf'.
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.customers
  ADD COLUMN IF NOT EXISTS whatsapp     text,
  ADD COLUMN IF NOT EXISTS gender       text,
  ADD COLUMN IF NOT EXISTS address      jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS origin       text,
  ADD COLUMN IF NOT EXISTS lgpd_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document     text;
ALTER TABLE openrate.customers DROP COLUMN IF EXISTS cpf;

-- ---------------------------------------------------------------------------
-- videos — resultado do ffprobe (quality gate do worker)
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.videos
  ADD COLUMN IF NOT EXISTS quality_check jsonb;

-- ---------------------------------------------------------------------------
-- payouts — chave do recibo (PDF) no MinIO
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.payouts
  ADD COLUMN IF NOT EXISTS receipt_key text;

-- ---------------------------------------------------------------------------
-- commission_rules — base do rateio (comissão de afiliado x valor bruto)
-- ---------------------------------------------------------------------------
ALTER TABLE openrate.commission_rules
  ADD COLUMN IF NOT EXISTS calc_base openrate.commission_base NOT NULL DEFAULT 'affiliate_payout';

-- migrate:down
SET search_path TO openrate, public;

ALTER TABLE openrate.commission_rules DROP COLUMN IF EXISTS calc_base;
ALTER TABLE openrate.payouts          DROP COLUMN IF EXISTS receipt_key;
ALTER TABLE openrate.videos           DROP COLUMN IF EXISTS quality_check;

ALTER TABLE openrate.customers ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE openrate.customers
  DROP COLUMN IF EXISTS document,
  DROP COLUMN IF EXISTS lgpd_consent,
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS whatsapp;

ALTER TABLE openrate.video_types
  DROP COLUMN IF EXISTS script_skeleton,
  DROP COLUMN IF EXISTS icon;

ALTER TABLE openrate.product_images DROP COLUMN IF EXISTS is_primary;

ALTER TABLE openrate.products
  DROP COLUMN IF EXISTS items_per_box,
  DROP COLUMN IF EXISTS length_cm,
  DROP COLUMN IF EXISTS width_cm,
  DROP COLUMN IF EXISTS height_cm,
  DROP COLUMN IF EXISTS weight_net_kg,
  DROP COLUMN IF EXISTS weight_gross_kg,
  DROP COLUMN IF EXISTS fiscal_origin,
  DROP COLUMN IF EXISTS cest,
  DROP COLUMN IF EXISTS ncm,
  DROP COLUMN IF EXISTS institutional_video_url,
  DROP COLUMN IF EXISTS seo_description,
  DROP COLUMN IF EXISTS seo_title,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS short_description,
  DROP COLUMN IF EXISTS cost_price,
  DROP COLUMN IF EXISTS unit,
  DROP COLUMN IF EXISTS product_type,
  DROP COLUMN IF EXISTS model;

ALTER TABLE openrate.users  DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE openrate.stores DROP COLUMN IF EXISTS whatsapp, DROP COLUMN IF EXISTS phone;
ALTER TABLE openrate.organizations
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS trade_name;

DROP TYPE IF EXISTS openrate.commission_base;
DROP TYPE IF EXISTS openrate.product_unit;
DROP TYPE IF EXISTS openrate.product_type;
DROP TYPE IF EXISTS openrate.org_status;
DROP TYPE IF EXISTS openrate.org_plan;
