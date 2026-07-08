import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  inviteUserSchema,
  updateUserSchema,
  roleAtLeast,
  type InviteUserInput,
  type UpdateUserInput,
  type TenantContext,
  type UserRole,
} from '@openrate/shared';
import type { PoolClient } from 'pg';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { hashPassword } from '../common/password';
import { QueuesService } from '../queues.service';

function newTempPassword(): string {
  return randomBytes(9).toString('base64url'); // ~12 chars
}

@Controller()
class UsersController {
  constructor(
    private readonly pg: PgService,
    private readonly queues: QueuesService,
  ) {}

  // Lojas em que o usuário atua (para exibir vínculos).
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

  // Todos os usuários da org (exceto excluídos), com o nome das lojas vinculadas.
  @Get('users')
  @Roles('manager')
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.active, u.image_release_status,
                  COALESCE((
                    SELECT array_agg(s.name ORDER BY s.name)
                      FROM openrate.user_stores us JOIN openrate.stores s ON s.id = us.store_id
                     WHERE us.user_id = u.id
                  ), '{}') AS stores
             FROM openrate.users u
            WHERE u.deleted_at IS NULL AND u.organization_id = $1
            ORDER BY u.full_name`,
          [t.orgId],
        )
        .then((r) => r.rows),
    );
  }

  @Get('users/:id')
  @Roles('manager')
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, email, full_name, role, phone, active, image_release_status, pix_key, pix_key_type
             FROM openrate.users WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }

  // Convite: cria o usuário DIRETO em openrate.users (auth própria) com senha temporária
  // e must_change_password=true. Vincula as lojas em user_stores (com loja principal).
  @Post('users/invite')
  @Roles('manager')
  async invite(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(inviteUserSchema)) dto: InviteUserInput,
  ): Promise<{ id: string; email: string; tempPassword: string }> {
    if (dto.role === 'super_admin') throw new ForbiddenException('super_admin não é criado por convite');
    if (!roleAtLeast(t.role, dto.role)) {
      throw new ForbiddenException('você não pode convidar um papel mais privilegiado que o seu');
    }
    assertOrgContext(t);

    const stores = dto.storeIds ?? (dto.storeId ? [dto.storeId] : t.storeId ? [t.storeId] : []);
    const defaultStoreId = dto.defaultStoreId ?? stores[0] ?? null;
    const tempPassword = newTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    let userId: string;
    try {
      userId = await this.pg.withTenant(t, async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO openrate.users
             (organization_id, role, email, full_name, phone, password_hash, must_change_password, pix_key, pix_key_type)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8) RETURNING id`,
          [t.orgId, dto.role, dto.email, dto.fullName, dto.phone ?? null, passwordHash, dto.pixKey ?? null, dto.pixKeyType ?? null],
        );
        const id = r.rows[0].id;
        await this.setStores(c, id, t.orgId!, stores, defaultStoreId);
        return id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('já existe um usuário com este e-mail');
      }
      throw e;
    }

    if (dto.phone) {
      await this.notifyWhatsApp(t, userId, dto.phone, 'user_invited', {
        tempPassword,
        email: dto.email,
      });
    }
    return { id: userId, email: dto.email, tempPassword };
  }

  @Patch('users/:id')
  @Roles('manager')
  async update(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
  ) {
    if (dto.role && (dto.role === 'super_admin' || !roleAtLeast(t.role, dto.role))) {
      throw new ForbiddenException('papel inválido para o seu nível');
    }
    return this.pg.withTenant(t, async (c) => {
      const cur = await c.query<{ role: UserRole }>(
        'SELECT role FROM openrate.users WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );
      const target = cur.rows[0];
      if (!target) throw new NotFoundException('usuário não encontrado');
      if (target.role === 'super_admin' || !roleAtLeast(t.role, target.role)) {
        throw new ForbiddenException('você não pode editar este usuário');
      }
      const upd = await c.query(
        `UPDATE openrate.users SET
           full_name = COALESCE($2, full_name),
           phone     = COALESCE($3, phone),
           role      = COALESCE($4, role),
           active    = COALESCE($5, active)
         WHERE id = $1 RETURNING id, email, full_name, role, phone, active`,
        [id, dto.fullName ?? null, dto.phone ?? null, dto.role ?? null, dto.active ?? null],
      );
      if (dto.storeIds) {
        await this.setStores(c, id, t.orgId!, dto.storeIds, dto.defaultStoreId ?? dto.storeIds[0] ?? null);
      }
      return upd.rows[0] ?? null;
    });
  }

  @Post('users/:id/reset-password')
  @Roles('manager')
  async resetPassword(
    @CurrentTenant() t: TenantContext,
    @Param('id') id: string,
  ): Promise<{ tempPassword: string }> {
    const tempPassword = newTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const info = await this.pg.withTenant(t, async (c) => {
      const cur = await c.query<{ role: UserRole; phone: string | null; email: string }>(
        'SELECT role, phone, email FROM openrate.users WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );
      const target = cur.rows[0];
      if (!target) throw new NotFoundException('usuário não encontrado');
      if (target.role === 'super_admin' || !roleAtLeast(t.role, target.role)) {
        throw new ForbiddenException('você não pode redefinir a senha deste usuário');
      }
      await c.query(
        'UPDATE openrate.users SET password_hash = $2, must_change_password = true WHERE id = $1',
        [id, passwordHash],
      );
      return target;
    });
    if (info.phone) {
      await this.notifyWhatsApp(t, id, info.phone, 'password_reset', {
        tempPassword,
        email: info.email,
      });
    }
    return { tempPassword };
  }

  // Substitui os vínculos loja↔usuário (full replace) marcando a loja principal.
  private async setStores(
    c: PoolClient,
    userId: string,
    orgId: string,
    storeIds: string[],
    defaultStoreId: string | null,
  ): Promise<void> {
    await c.query('DELETE FROM openrate.user_stores WHERE user_id = $1', [userId]);
    for (const storeId of storeIds) {
      await c.query(
        `INSERT INTO openrate.user_stores (user_id, store_id, organization_id, is_default)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [userId, storeId, orgId, storeId === defaultStoreId],
      );
    }
  }

  // Best-effort (padrão do payouts.pay): grava a notificação e enfileira; falha de
  // enfileiramento não derruba a operação principal (que já foi commitada).
  private async notifyWhatsApp(
    t: TenantContext,
    userId: string,
    to: string,
    template: string,
    vars: Record<string, string>,
  ): Promise<void> {
    if (!t.orgId) return;
    try {
      const notif = await this.pg.withTenant(t, (c) =>
        c
          .query<{ id: string }>(
            `INSERT INTO openrate.notifications (organization_id, user_id, channel, template, body, status, payload)
             VALUES ($1,$2,'whatsapp',$3,$4,'pending',$5) RETURNING id`,
            [t.orgId, userId, template, `Senha temporária: ${vars.tempPassword}`, JSON.stringify(vars)],
          )
          .then((r) => r.rows[0]),
      );
      await this.queues.enqueueNotification({
        orgId: t.orgId,
        userId,
        correlationId: t.correlationId,
        notificationId: notif.id,
        channel: 'whatsapp',
        template,
        to,
        vars,
      });
    } catch {
      // notificação fica 'pending'/não enfileirada; não derruba o convite/reset.
    }
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
