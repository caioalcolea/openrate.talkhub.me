import { z } from 'zod';
import { USER_ROLES, type UserRole } from './enums';

// Marca do produto dentro de app_metadata no JWT. A API rejeita tokens sem ela.
export const OPENRATE_PRODUCT = 'openrate' as const;

// app_metadata que a API grava no JWT ao provisionar/autenticar o usuário.
export const appMetadataSchema = z.object({
  product: z.literal(OPENRATE_PRODUCT),
  org_id: z.string().uuid().nullable().optional(),
  store_id: z.string().uuid().nullable().optional(),
  role: z.enum(USER_ROLES),
});
export type AppMetadata = z.infer<typeof appMetadataSchema>;

// Claims do JWT (HS256) emitido e validado localmente pela API.
export const jwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email().optional(),
  exp: z.number().optional(),
  app_metadata: appMetadataSchema,
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;

// Contexto de tenant resolvido a partir das claims — propagado por
// AsyncLocalStorage na API e injetado no set_config('request.jwt.claims').
export interface TenantContext {
  userId: string;
  orgId: string | null;
  storeId: string | null;
  role: UserRole;
  correlationId: string;
}

export function isSuperAdmin(role: UserRole): boolean {
  return role === 'super_admin';
}

// Hierarquia simples de papéis (maior = mais permissões).
const ROLE_RANK: Record<UserRole, number> = {
  attendant: 1,
  manager: 2,
  owner: 3,
  super_admin: 4,
};

export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// Monta o JSON de claims que a API injeta no GUC request.jwt.claims por
// transação (is_local=true) — é a partir dele que as policies RLS leem
// org_id/role do tenant corrente.
export function claimsForSetConfig(ctx: TenantContext): string {
  return JSON.stringify({
    sub: ctx.userId,
    app_metadata: {
      product: OPENRATE_PRODUCT,
      org_id: ctx.orgId,
      store_id: ctx.storeId,
      role: ctx.role,
    },
  });
}
