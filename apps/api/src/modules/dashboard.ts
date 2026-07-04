import { Controller, Get, Module } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TenantContext } from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { Roles } from '../auth/roles.decorator';

@Controller()
class DashboardController {
  constructor(private readonly pg: PgService) {}

  // Dashboard por papel: manager vê a própria loja; owner/super veem a org toda.
  // Atendente NÃO acessa (veria agregados/top creators da org). O RLS já isola
  // por org; o filtro de loja é autorização fina da camada de API.
  @Get('dashboard')
  @Roles('manager')
  dashboard(@CurrentTenant() t: TenantContext) {
    const storeId = t.role === 'manager' ? t.storeId : null;
    return this.pg.withTenant(t, async (c: PoolClient) => {
      const sales = await c.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(gross_amount),0) AS gross
           FROM openrate.affiliate_sales
          WHERE status = 'confirmed' AND ($1::uuid IS NULL OR store_id = $1)`,
        [storeId],
      );
      const commission = await c.query(
        `SELECT beneficiary_type, COALESCE(SUM(amount),0) AS total
           FROM openrate.commission_entries
          WHERE status <> 'cancelled' AND ($1::uuid IS NULL OR store_id = $1 OR beneficiary_type = 'creator')
          GROUP BY beneficiary_type`,
        [storeId],
      );
      const videos = await c.query(
        `SELECT status, COUNT(*)::int AS count
           FROM openrate.videos
          WHERE ($1::uuid IS NULL OR store_id = $1)
          GROUP BY status`,
        [storeId],
      );
      const topCreators = await c.query(
        `SELECT e.user_id, u.full_name, COALESCE(SUM(e.amount),0) AS total
           FROM openrate.commission_entries e
           JOIN openrate.users u ON u.id = e.user_id
          WHERE e.beneficiary_type = 'creator' AND e.status <> 'cancelled'
          GROUP BY e.user_id, u.full_name
          ORDER BY total DESC LIMIT 5`,
        [],
      );
      return {
        sales: { count: sales.rows[0].count, gross: sales.rows[0].gross },
        commissionByType: commission.rows,
        videosByStatus: videos.rows,
        topCreators: topCreators.rows,
      };
    });
  }

  // Ganhos do próprio atendente (PWA): comissões por status + ranking na org.
  @Get('me/earnings')
  earnings(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, async (c: PoolClient) => {
      const byStatus = await c.query(
        `SELECT status, COALESCE(SUM(amount),0) AS total
           FROM openrate.commission_entries
          WHERE beneficiary_type = 'creator' AND user_id = $1
          GROUP BY status`,
        [t.userId],
      );
      const approvedVideos = await c.query(
        `SELECT COUNT(*)::int AS count FROM openrate.videos WHERE user_id = $1 AND status IN ('approved','published')`,
        [t.userId],
      );
      const ranking = await c.query(
        `WITH totals AS (
           SELECT user_id, SUM(amount) AS total
             FROM openrate.commission_entries
            WHERE beneficiary_type = 'creator' AND status <> 'cancelled'
            GROUP BY user_id
         )
         SELECT rank FROM (
           SELECT user_id, RANK() OVER (ORDER BY total DESC) AS rank FROM totals
         ) r WHERE user_id = $1`,
        [t.userId],
      );
      return {
        byStatus: byStatus.rows,
        approvedVideos: approvedVideos.rows[0].count,
        rank: ranking.rows[0]?.rank ?? null,
      };
    });
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
