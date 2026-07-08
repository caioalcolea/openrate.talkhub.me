import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '@openrate/shared';

export interface RequestWithTenant extends Request {
  tenant?: TenantContext;
}

// Escritas tenant-scoped exigem uma org no contexto. Um super_admin recém-criado
// tem org_id null até "entrar" numa org (POST /v1/auth/switch-org); sem isto os
// controllers jogariam null em colunas NOT NULL/CHECK e o Postgres devolveria 500.
export function assertOrgContext(t: TenantContext): void {
  if (!t.orgId) {
    throw new BadRequestException(
      'Selecione uma organização antes de criar recursos (super_admin: entre em uma org primeiro).',
    );
  }
}

// @Public() marca rotas que dispensam JWT (health, webhooks, login).
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

// @CurrentTenant() injeta o contexto de tenant resolvido pelo JwtAuthGuard.
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithTenant>();
    if (!req.tenant) throw new Error('TenantContext ausente (rota sem JwtAuthGuard?)');
    return req.tenant;
  },
);
