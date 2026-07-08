import { Controller, Get, Module, Param, Post } from '@nestjs/common';
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
          `SELECT id, channel, template, title, body, status, read_at, created_at
             FROM openrate.notifications
            WHERE user_id = $1
            ORDER BY created_at DESC LIMIT 100`,
          [t.userId],
        )
        .then((r) => r.rows),
    );
  }

  @Post('read-all')
  readAll(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.notifications SET status = 'read', read_at = now()
             WHERE user_id = $1 AND status <> 'read'`,
          [t.userId],
        )
        .then((r) => ({ updated: r.rowCount ?? 0 })),
    );
  }

  @Post(':id/read')
  read(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.notifications SET status = 'read', read_at = now()
             WHERE id = $1 AND user_id = $2 RETURNING id`,
          [id, t.userId],
        )
        .then((r) => ({ ok: (r.rowCount ?? 0) > 0 })),
    );
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
