import { z } from 'zod';
import {
  PRODUCT_SCOPES,
  PRODUCT_ORIGINS,
  PRODUCT_TYPES,
  PRODUCT_UNITS,
  USER_ROLES,
  PUBLICATION_PLATFORMS,
  GOAL_PERIODS,
  GOAL_METRICS,
  ORG_PLANS,
  ORG_STATUSES,
  COMMISSION_BASES,
  PIX_KEY_TYPES,
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
const slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9-]+$/, 'use kebab-case: minúsculas, números e hífens');

// Endereço estruturado (reusado por lojas e clientes; guardado em coluna jsonb).
export const addressSchema = z.object({
  cep: z.string().max(9).optional(),
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  complement: z.string().max(120).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().length(2).optional(),
});
export type Address = z.infer<typeof addressSchema>;

const pixKeyType = z.enum(PIX_KEY_TYPES);

// --- Organização ---
export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(160),
  tradeName: z.string().max(160).optional(),
  slug,
  document: z.string().max(20).optional(),
  plan: z.enum(ORG_PLANS).optional(), // default 'free' aplicado no banco/endpoint
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  tradeName: z.string().max(160).nullable().optional(),
  document: z.string().max(20).nullable().optional(),
  plan: z.enum(ORG_PLANS).optional(),
  status: z.enum(ORG_STATUSES).optional(),
  active: z.boolean().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// --- Loja ---
export const createStoreSchema = z.object({
  name: z.string().min(2).max(160),
  document: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  whatsapp: z.string().max(20).optional(),
  address: addressSchema.optional(),
  timezone: z.string().max(60).optional(),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  document: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  whatsapp: z.string().max(20).nullable().optional(),
  address: addressSchema.optional(),
  timezone: z.string().max(60).optional(),
  active: z.boolean().optional(),
});
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

// --- Usuário / convite / senha ---
export const inviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(160),
  role: z.enum(USER_ROLES),
  phone: z.string().max(20).optional(), // E.164 p/ WhatsApp
  storeId: uuid.nullable().optional(), // legado (loja única) — T7 migra p/ storeIds
  storeIds: z.array(uuid).max(200).optional(), // lojas vinculadas (user_stores)
  defaultStoreId: uuid.nullable().optional(), // loja principal (is_default)
  pixKey: z.string().max(140).optional(),
  pixKeyType: pixKeyType.optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(), // opcional no fluxo "troca obrigatória"
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// --- Produto (formulário em abas) ---
export const createProductSchema = z.object({
  name: z.string().min(2).max(240),
  model: z.string().max(160).optional(),
  productType: z.enum(PRODUCT_TYPES).optional(), // default 'simple' no banco/endpoint
  scope: z.enum(PRODUCT_SCOPES).default('store'),
  origin: z.enum(PRODUCT_ORIGINS).default('manual'),
  storeId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  brandId: uuid.nullable().optional(),
  sku: z.string().max(80).optional(),
  gtin: z.string().max(20).optional(),
  unit: z.enum(PRODUCT_UNITS).optional(),
  // fiscal
  ncm: z.string().max(20).optional(),
  cest: z.string().max(20).optional(),
  fiscalOrigin: z.string().max(2).optional(),
  // preços
  price: money.optional(),
  promoPrice: money.optional(),
  costPrice: money.optional(),
  // descrição / seo
  shortDescription: z.string().max(500).optional(),
  description: z.string().max(20000).optional(), // HTML (rich text)
  tags: z.array(z.string().max(60)).max(50).optional(),
  seoTitle: z.string().max(160).optional(),
  seoDescription: z.string().max(320).optional(),
  institutionalVideoUrl: z.string().max(500).optional(),
  // logística
  weightGrossKg: z.number().nonnegative().optional(),
  weightNetKg: z.number().nonnegative().optional(),
  heightCm: z.number().nonnegative().optional(),
  widthCm: z.number().nonnegative().optional(),
  lengthCm: z.number().nonnegative().optional(),
  itemsPerBox: z.number().int().positive().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Edição: todos os campos opcionais (patch parcial).
export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const createProductVariationSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(80).optional(),
  price: money.optional(),
  attributes: z.record(z.string()).optional(), // ex.: { sabor: "baunilha" }
  active: z.boolean().optional(),
});
export type CreateProductVariationInput = z.infer<typeof createProductVariationSchema>;

export const upsertStoreInventorySchema = z.object({
  storeId: uuid,
  productId: uuid,
  variationId: uuid.nullable().optional(),
  quantity: z.number().int().min(0),
  priceOverride: money.optional(),
  available: z.boolean().optional(),
});
export type UpsertStoreInventoryInput = z.infer<typeof upsertStoreInventorySchema>;

// --- Catálogo: marca, categoria, tipo de vídeo ---
export const createBrandSchema = z.object({
  name: z.string().min(1).max(160),
  logoKey: z.string().max(300).optional(), // objeto no MinIO (upload via presign)
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1).max(160),
  slug,
  parentId: uuid.nullable().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// Passo do esqueleto de roteiro de um tipo de vídeo (editor de passos).
const scriptStepSchema = z.object({
  step: z.number().int().positive(),
  action: z.string().min(1).max(400),
  speech: z.string().max(1000).optional(),
});

export const createVideoTypeSchema = z.object({
  name: z.string().min(1).max(160),
  slug,
  icon: z.string().max(60).optional(),
  description: z.string().max(1000).optional(),
  promptTemplate: z.string().max(8000).optional(),
  defaultDurationSeconds: z.number().int().positive().max(600).optional(),
  scriptSkeleton: z.array(scriptStepSchema).max(30).optional(),
});
export type CreateVideoTypeInput = z.infer<typeof createVideoTypeSchema>;

export const generateIdeasSchema = z.object({
  videoTypeId: uuid,
  count: z.number().int().min(1).max(60).default(40),
  regenerate: z.boolean().default(false),
});
export type GenerateIdeasInput = z.infer<typeof generateIdeasSchema>;

// Ideia manual (source='manual'): mesmos campos que a IA gera.
export const createIdeaSchema = z.object({
  videoTypeId: uuid.nullable().optional(),
  hook: z.string().min(3).max(300),
  script: z
    .array(
      z.object({
        step: z.number().int().positive(),
        instruction: z.string().min(1),
        durationSeconds: z.number().int().positive().max(120).optional(),
      }),
    )
    .min(1)
    .max(20),
  caption: z.string().max(2200).optional(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  targetDurationSeconds: z.number().int().positive().max(180).optional(),
});
export type CreateIdeaInput = z.infer<typeof createIdeaSchema>;

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
    name: z.string().min(2).max(160).optional(),
    storeId: uuid.nullable().optional(),
    productId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    platform: z.enum(PUBLICATION_PLATFORMS).nullable().optional(),
    calcBase: z.enum(COMMISSION_BASES).optional(), // default 'affiliate_payout' no banco/endpoint
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
  name: z.string().min(2).max(160),
  storeId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(),
  period: z.enum(GOAL_PERIODS).default('daily'),
  metric: z.enum(GOAL_METRICS),
  targetValue: z.number().positive(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

// --- CRM: cliente e venda da loja física ---
export const createCustomerSchema = z.object({
  name: z.string().min(2).max(200),
  document: z.string().max(20).optional(), // CPF ou CNPJ
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  whatsapp: z.string().max(20).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.string().max(20).optional(),
  address: addressSchema.optional(),
  origin: z.string().max(40).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  lgpdConsent: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  storeId: uuid.nullable().optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const createStoreSaleSchema = z.object({
  storeId: uuid.nullable().optional(),
  customerId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(), // atendente da venda
  totalAmount: money,
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(240),
        quantity: z.number().positive(),
        price: money,
      }),
    )
    .optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateStoreSaleInput = z.infer<typeof createStoreSaleSchema>;

// --- Sprint 4: afiliados, vendas e comissão ---

// Registro manual de "publiquei este vídeo na plataforma X" + link de afiliado.
// destino do redirect: só http(s) (bloqueia javascript:/data: — o /r/:code é
// público e faz 302 para esta URL).
const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), {
  message: 'a URL deve começar com http:// ou https://',
});

export const createPublicationSchema = z.object({
  platform: z.enum(PUBLICATION_PLATFORMS),
  externalUrl: httpUrl.optional(), // URL pública do post
  destinationUrl: httpUrl, // URL de afiliado (destino do redirect)
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
  // 'evp' = chave aleatória. Igual ao CHECK de users.pix_key_type no banco.
  pixKeyType,
  cpf: z.string().max(14).optional(),
});
export type UpdatePixInput = z.infer<typeof updatePixSchema>;
