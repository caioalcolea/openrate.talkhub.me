import { Controller, Get, Module } from '@nestjs/common';
import type { TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';

@Controller('notifications')
class NotificationsController {
  constructor(private readonly pg: PgService) {}

  // Central de notificações do próprio usuário (RLS isola por org; filtro por
  // user_id garante que o atendente veja só as suas).
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, channel, template, title, body, status, created_at
             FROM openrate.notifications
            WHERE user_id = $1
            ORDER BY created_at DESC LIMIT 100`,
          [t.userId],
        )
        .then((r) => r.rows),
    );
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
