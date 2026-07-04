import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import {
  createGoalSchema,
  type CreateGoalInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { assertOrgContext, CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';

@Controller('goals')
class GoalsController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          'SELECT id, store_id, user_id, period, target_videos, target_sales_amount, active FROM openrate.goals WHERE active = true',
        )
        .then((r) => r.rows),
    );
  }

  @Post()
  @Roles('manager')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createGoalSchema)) dto: CreateGoalInput,
  ) {
    assertOrgContext(t);
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.goals
             (organization_id, store_id, user_id, name, period, target_videos, target_sales_amount, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            t.orgId,
            dto.storeId ?? null,
            dto.userId ?? null,
            dto.name,
            dto.period,
            dto.targetVideos,
            dto.targetSalesAmount ?? null,
            t.userId,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }

  // Progresso do dia (view v_goal_progress_daily, security_invoker → herda RLS).
  @Get('progress')
  progress(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c.query('SELECT * FROM openrate.v_goal_progress_daily').then((r) => r.rows),
    );
  }
}

@Module({ controllers: [GoalsController] })
export class GoalsModule {}
