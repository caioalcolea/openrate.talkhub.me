import { Controller, Get, Module, Query } from '@nestjs/common';
import type { TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { Roles } from '../auth/roles.decorator';

// Leitura do log de auditoria. RLS isola por org (owner vê a própria org;
// super_admin vê tudo via super_admin_all). Somente owner+ (dado sensível).
@Controller('audit-log')
class AuditController {
  constructor(private readonly pg: PgService) {}

  @Get()
  @Roles('owner')
  list(
    @CurrentTenant() t: TenantContext,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    const lim = Math.min(Number(limit) || 300, 1000);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT a.id, a.action, a.entity_type, a.entity_id, a.user_id,
                  u.full_name AS user_name, a.ip, a.new_data, a.created_at
             FROM openrate.audit_log a
             LEFT JOIN openrate.users u ON u.id = a.user_id
            WHERE ($2::text IS NULL OR a.action = $2)
              AND ($3::text IS NULL OR a.entity_type = $3)
            ORDER BY a.id DESC LIMIT $1`,
          [lim, action || null, entityType || null],
        )
        .then((r) => r.rows),
    );
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
