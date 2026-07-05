// Espelho EXATO dos ENUMs do schema openrate (db/migrations/0001_init.sql).
// Fonte única de verdade dos valores de domínio para API, worker e web.

export const USER_ROLES = ['super_admin', 'owner', 'manager', 'attendant'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PRODUCT_SCOPES = ['store', 'organization', 'platform'] as const;
export type ProductScope = (typeof PRODUCT_SCOPES)[number];

export const PRODUCT_ORIGINS = ['integration', 'manual', 'platform'] as const;
export type ProductOrigin = (typeof PRODUCT_ORIGINS)[number];

export const VIDEO_STATUSES = [
  'draft',
  'recording',
  'uploaded',
  'processing',
  'ready',
  'approved',
  'rejected',
  'published',
  'failed',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const PUBLICATION_PLATFORMS = [
  'tiktok',
  'instagram_reels',
  'shopee_video',
  'kwai',
  'mercado_livre_clips',
  'youtube_shorts',
] as const;
export type PublicationPlatform = (typeof PUBLICATION_PLATFORMS)[number];

export const PUBLICATION_STATUSES = [
  'pending',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'removed',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const SALE_STATUSES = ['pending', 'confirmed', 'cancelled', 'refunded'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const COMMISSION_ENTRY_STATUSES = [
  'pending',
  'payable',
  'settled',
  'paid',
  'cancelled',
] as const;
export type CommissionEntryStatus = (typeof COMMISSION_ENTRY_STATUSES)[number];

export const PAYOUT_STATUSES = [
  'pending_approval',
  'approved',
  'processing',
  'paid',
  'failed',
  'cancelled',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const GOAL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

// Métrica medida por uma meta (ver v_goal_progress_daily / migration 0007).
export const GOAL_METRICS = [
  'videos_recorded',
  'videos_published',
  'views',
  'affiliate_revenue',
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const INTEGRATION_PROVIDERS = [
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
  'other',
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const NOTIFICATION_CHANNELS = ['whatsapp', 'push', 'email', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const COMMISSION_BENEFICIARIES = ['creator', 'store', 'platform'] as const;
export type CommissionBeneficiary = (typeof COMMISSION_BENEFICIARIES)[number];

// Ordem de especificidade do motor de comissão (mais específica vence).
// Espelha o priority GENERATED da tabela commission_rules:
// product(16) > category(8) > store(4) > organization(2) > platform(1).
export const COMMISSION_RULE_WEIGHTS = {
  product: 16,
  category: 8,
  store: 4,
  organization: 2,
  platform: 1,
} as const;

// --- Enums adicionados na migration 0006 (estrutura completa dos cadastros) ---

// Organização — plano e status de assinatura.
export const ORG_PLANS = ['free', 'pro', 'rede'] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

export const ORG_STATUSES = ['active', 'suspended', 'churned'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

// Produto — tipo e unidade de medida.
export const PRODUCT_TYPES = ['simple', 'kit', 'variation_parent'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_UNITS = ['UN', 'KG', 'CX', 'PCT'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

// Regra de comissão — base do rateio (comissão de afiliado x valor bruto da venda).
export const COMMISSION_BASES = ['affiliate_payout', 'gross_sale'] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

// Tipos de chave Pix (espelha o CHECK de users.pix_key_type; 'evp' = aleatória).
export const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'evp'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];
