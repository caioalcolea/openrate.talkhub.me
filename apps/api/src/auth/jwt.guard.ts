import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  jwtClaimsSchema,
  OPENRATE_PRODUCT,
  roleAtLeast,
  isSuperAdmin,
  type TenantContext,
  type UserRole,
} from '@openrate/shared';
import { env } from '../common/env';
import { IS_PUBLIC, RequestWithTenant } from '../common/tenant';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithTenant>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('token ausente');
    }

    let decoded: unknown;
    try {
      decoded = jwt.verify(header.slice(7), env.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('token inválido');
    }

    // Refresh tokens têm o mesmo shape de claims (só um typ='refresh' a mais) e
    // NÃO podem autenticar chamadas de API — senão o TTL de 12h do access token
    // seria contornado pelos 30 dias do refresh. Só o /v1/auth/refresh os aceita.
    if ((decoded as { typ?: unknown } | null)?.typ === 'refresh') {
      throw new UnauthorizedException('refresh token não pode ser usado como access token');
    }

    const parsed = jwtClaimsSchema.safeParse(decoded);
    if (!parsed.success) throw new UnauthorizedException('claims inválidos');
    if (parsed.data.app_metadata.product !== OPENRATE_PRODUCT) {
      throw new UnauthorizedException('token de outro produto');
    }

    const claims = parsed.data;
    const tenant: TenantContext = {
      userId: claims.sub,
      orgId: claims.app_metadata.org_id ?? null,
      storeId: claims.app_metadata.store_id ?? null,
      role: claims.app_metadata.role,
      correlationId: (req.headers['x-request-id'] as string) || randomUUID(),
    };
    req.tenant = tenant;

    // Autorização por papel (@Roles). super_admin sempre passa.
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const ok = isSuperAdmin(tenant.role) || required.some((r) => roleAtLeast(tenant.role, r));
      if (!ok) throw new ForbiddenException('papel insuficiente');
    }
    return true;
  }
}
