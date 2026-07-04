import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  inviteUserSchema,
  roleAtLeast,
  type InviteUserInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { hashPassword } from '../common/password';

@Controller()
class UsersController {
  constructor(private readonly pg: PgService) {}

  @Get('stores/:id/users')
  @Roles('manager')
  listByStore(@CurrentTenant() t: TenantContext, @Param('id') storeId: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.image_release_status
             FROM openrate.users u
             JOIN openrate.user_stores us ON us.user_id = u.id
            WHERE us.store_id = $1`,
          [storeId],
        )
        .then((r) => r.rows),
    );
  }

  // Convite: cria o usuário DIRETO em openrate.users (auth própria; o gotrue
  // compartilhado tem login por e-mail desabilitado) com uma senha temporária que
  // o convidante repassa. A inserção roda no tenant do convidante (RLS garante que
  // só cria dentro da org dele). O convidado troca a senha depois.
  @Post('users/invite')
  @Roles('manager')
  async invite(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(inviteUserSchema)) dto: InviteUserInput,
  ): Promise<{ id: string; email: string; tempPassword: string }> {
    // Anti-escalonamento: nunca convidar super_admin, nem alguém mais privilegiado.
    if (dto.role === 'super_admin') {
      throw new ForbiddenException('super_admin não é criado por convite');
    }
    if (!roleAtLeast(t.role, dto.role)) {
      throw new ForbiddenException('você não pode convidar um papel mais privilegiado que o seu');
    }
    assertOrgContext(t); // super_admin precisa entrar numa org antes de convidar
    const storeId = dto.storeId ?? t.storeId ?? null;
    const tempPassword = randomBytes(9).toString('base64url'); // ~12 chars
    const passwordHash = await hashPassword(tempPassword);

    try {
      const userId = await this.pg.withTenant(t, async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO openrate.users (organization_id, role, email, full_name, phone, password_hash)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [t.orgId, dto.role, dto.email, dto.fullName, dto.phone ?? null, passwordHash],
        );
        const id = r.rows[0].id;
        if (storeId) {
          await c.query(
            `INSERT INTO openrate.user_stores (user_id, store_id, organization_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [id, storeId, t.orgId],
          );
        }
        return id;
      });
      return { id: userId, email: dto.email, tempPassword };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('já existe um usuário com este e-mail');
      }
      throw e;
    }
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
