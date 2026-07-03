import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '@openrate/shared';

export interface RequestWithTenant extends Request {
  tenant?: TenantContext;
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
