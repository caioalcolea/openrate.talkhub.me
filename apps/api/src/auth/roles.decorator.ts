import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@openrate/shared';

export const ROLES_KEY = 'roles';

// @Roles('manager') exige papel >= manager (super_admin sempre passa).
// A checagem é feita no JwtAuthGuard (que já resolveu o TenantContext).
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
