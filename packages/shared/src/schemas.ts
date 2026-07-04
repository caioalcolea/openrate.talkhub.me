import { z } from 'zod';
import {
  PRODUCT_SCOPES,
  PRODUCT_ORIGINS,
  USER_ROLES,
  PUBLICATION_PLATFORMS,
  GOAL_PERIODS,
} from './enums';

// ---------------------------------------------------------------------------
// Saída da IA (fila ai-script-generation): as 40 ideias por produto.
// O worker valida a resposta do Claude contra este schema ANTES de persistir
// em video_ideas — resposta fora do schema conta como falha do job.
// ---------------------------------------------------------------------------
export const videoIdeaSchema = z.object({
  hook: z.string().min(3).max(300),
  script: z
    .array(
      z.object({
        step: z.number().int().positive(),
        instruction: z.string().min(3),
        durationSeconds: z.number().int().positive().max(120).optional(),
      }),
    )
    .min(1)
    .max(20),
  caption: z.string().min(3).max(2200),
  hashtags: z.array(z.string().regex(/^#?[\p{L}0-9_]+$/u)).max(30),
  targetDurationSeconds: z.number().int().positive().max(180),
});
export type VideoIdea = z.infer<typeof videoIdeaSchema>;

export const videoIdeasBatchSchema = z.object({
  ideas: z.array(videoIdeaSchema).min(1).max(60),
});
export type VideoIdeasBatch = z.infer<typeof videoIdeasBatchSchema>;

// ---------------------------------------------------------------------------
// DTOs de entrada da API (validados por zod nos controllers).
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const money = z.number().nonnegative().multipleOf(0.01);
const pct = z.number().min(0).max(100);

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  document: z.string().max(20).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const createStoreSchema = z.object({
  name: z.string().min(2).max(160),
  document: z.string().max(20).optional(),
  city: z.string().max(120).optional(),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(160),
  role: z.enum(USER_ROLES),
  storeId: uuid.nullable().optional(),
  phone: z.string().max(20).optional(), // E.164 p/ WhatsApp
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const createProductSchema = z.object({
  name: z.string().min(2).max(240),
  description: z.string().max(4000).optional(),
  scope: z.enum(PRODUCT_SCOPES).default('store'),
  origin: z.enum(PRODUCT_ORIGINS).default('manual'),
  storeId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  brandId: uuid.nullable().optional(),
  price: money.optional(),
  sku: z.string().max(80).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const generateIdeasSchema = z.object({
  videoTypeId: uuid,
  count: z.number().int().min(1).max(60).default(40),
  regenerate: z.boolean().default(false),
});
export type GenerateIdeasInput = z.infer<typeof generateIdeasSchema>;

// Início de upload de vídeo: a API cria o registro + presigned multipart.
export const startVideoUploadSchema = z.object({
  videoIdeaId: uuid,
  productId: uuid,
  contentType: z.string().regex(/^video\//),
  fileSize: z.number().int().positive(),
  partCount: z.number().int().min(1).max(10_000),
});
export type StartVideoUploadInput = z.infer<typeof startVideoUploadSchema>;

export const completeVideoUploadSchema = z.object({
  uploadId: z.string(),
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string() }))
    .min(1),
});
export type CompleteVideoUploadInput = z.infer<typeof completeVideoUploadSchema>;

export const rejectVideoSchema = z.object({
  reason: z.string().min(3).max(1000),
});

export const createCommissionRuleSchema = z
  .object({
    storeId: uuid.nullable().optional(),
    productId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    platform: z.enum(PUBLICATION_PLATFORMS).nullable().optional(),
    creatorPct: pct,
    storePct: pct,
    platformPct: pct,
  })
  .refine((r) => r.creatorPct + r.storePct + r.platformPct <= 100, {
    message: 'A soma dos percentuais (creator + store + platform) não pode exceder 100.',
  });
export type CreateCommissionRuleInput = z.infer<typeof createCommissionRuleSchema>;

// Linha do CSV de importação de vendas de afiliado.
export const affiliateSaleRowSchema = z.object({
  platform: z.enum(PUBLICATION_PLATFORMS),
  externalId: z.string().min(1),
  affiliateShortCode: z.string().min(1),
  amount: money,
  commissionableAmount: money.optional(),
  soldAt: z.string().datetime().optional(),
});
export type AffiliateSaleRow = z.infer<typeof affiliateSaleRowSchema>;

export const createGoalSchema = z.object({
  storeId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(),
  period: z.enum(GOAL_PERIODS).default('daily'),
  targetVideos: z.number().int().min(1).max(1000),
  targetSalesAmount: money.optional(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

// --- Sprint 4: afiliados, vendas e comissão ---

// Registro manual de "publiquei este vídeo na plataforma X" + link de afiliado.
export const createPublicationSchema = z.object({
  platform: z.enum(PUBLICATION_PLATFORMS),
  externalUrl: z.string().url().optional(), // URL pública do post
  destinationUrl: z.string().url(), // URL de afiliado (destino do redirect)
  caption: z.string().max(2200).optional(),
});
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

// Simulador do motor de comissão (conferência do manager).
export const simulateCommissionSchema = z.object({
  amount: money,
  storeId: uuid.nullable().optional(),
  productId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  platform: z.enum(PUBLICATION_PLATFORMS).nullable().optional(),
});
export type SimulateCommissionInput = z.infer<typeof simulateCommissionSchema>;

// Carência padrão até a comissão ficar pagável (dias). Override por org.settings.
export const DEFAULT_PAYOUT_GRACE_DAYS = 30;

// --- Sprint 5: fechamento, payout e chave Pix ---

// Fechamento de período: consolida comissões due em payouts por creator.
export const closeSettlementSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
});
export type CloseSettlementInput = z.infer<typeof closeSettlementSchema>;

// Registro do pagamento manual (Pix feito fora do sistema, registrado dentro).
export const payPayoutSchema = z.object({
  proof: z.string().max(500).optional(), // comprovante/observação
});
export type PayPayoutInput = z.infer<typeof payPayoutSchema>;

// Cadastro/edição da própria chave Pix (dado sensível do recebedor).
export const updatePixSchema = z.object({
  pixKey: z.string().min(1).max(140),
  pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random']),
  cpf: z.string().max(14).optional(),
});
export type UpdatePixInput = z.infer<typeof updatePixSchema>;
