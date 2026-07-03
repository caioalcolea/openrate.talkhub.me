import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import axios from 'axios';
import {
  inviteUserSchema,
  type InviteUserInput,
  OPENRATE_PRODUCT,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { env } from '../common/env';

@Controller()
class UsersController {
  constructor(private readonly pg: PgService) {}

  @Get('stores/:id/users')
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

  // Convite: cria o usuário no gotrue (Admin API, service_role) com app_metadata
  // {product, org_id, store_id, role} e grava o espelho em openrate.users.
  @Post('users/invite')
  @Roles('manager')
  async invite(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(inviteUserSchema)) dto: InviteUserInput,
  ): Promise<{ id: string; email: string }> {
    const storeId = dto.storeId ?? t.storeId ?? null;
    const created = await axios.post(
      `${env.supabaseUrl}/auth/v1/admin/users`,
      {
        email: dto.email,
        email_confirm: true,
        app_metadata: {
          product: OPENRATE_PRODUCT,
          org_id: t.orgId,
          store_id: storeId,
          role: dto.role,
        },
        user_metadata: { full_name: dto.fullName },
      },
      {
        headers: {
          apikey: env.supabaseServiceRoleKey,
          Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const userId: string = created.data.id;

    await this.pg.withTenant(t, async (c) => {
      await c.query(
        `INSERT INTO openrate.users (id, organization_id, role, email, full_name, phone)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name`,
        [userId, t.orgId, dto.role, dto.email, dto.fullName, dto.phone ?? null],
      );
      if (storeId) {
        await c.query(
          `INSERT INTO openrate.user_stores (user_id, store_id, organization_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [userId, storeId, t.orgId],
        );
      }
    });

    return { id: userId, email: dto.email };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
