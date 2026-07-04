import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import {
  createCommissionRuleSchema,
  simulateCommissionSchema,
  resolveRule,
  splitCommission,
  type CreateCommissionRuleInput,
  type SimulateCommissionInput,
  type TenantContext,
} from '@openrate/shared';
import { PgService } from '../common/pg.service';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { loadApplicableRules } from '../common/commission-ingest';

// Motor de comissão (Sprint 4) — aqui o CRUD das regras. A resolução
// "mais específica vence" (priority GENERATED) roda na ingestão de vendas.
@Controller('commission-rules')
class CommissionRulesController {
  constructor(private readonly pg: PgService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `SELECT id, store_id, product_id, category_id, platform,
                  creator_pct, store_pct, platform_pct, priority, active
             FROM openrate.commission_rules
            ORDER BY priority DESC`,
        )
        .then((r) => r.rows),
    );
  }

  @Post()
  @Roles('owner')
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(createCommissionRuleSchema)) dto: CreateCommissionRuleInput,
  ) {
    // priority é GENERATED ALWAYS — não enviar.
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `INSERT INTO openrate.commission_rules
             (organization_id, store_id, product_id, category_id, platform,
              creator_pct, store_pct, platform_pct, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            t.orgId,
            dto.storeId ?? null,
            dto.productId ?? null,
            dto.categoryId ?? null,
            dto.platform ?? null,
            dto.creatorPct,
            dto.storePct,
            dto.platformPct,
            t.userId,
          ],
        )
        .then((r) => r.rows[0]),
    );
  }

  // Simulador: dada uma venda hipotética, mostra qual regra vence e o rateio.
  @Post('simulate')
  async simulate(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(simulateCommissionSchema)) dto: SimulateCommissionInput,
  ) {
    if (!t.orgId) throw new Error('org ausente');
    return this.pg.withTenant(t, async (c) => {
      const rules = await loadApplicableRules(c, t.orgId as string);
      const rule = resolveRule(rules, {
        organizationId: t.orgId as string,
        storeId: dto.storeId ?? null,
        productId: dto.productId ?? null,
        categoryId: dto.categoryId ?? null,
        platform: dto.platform ?? null,
      });
      if (!rule) return { rule: null, split: null, message: 'Nenhuma regra aplicável.' };
      return { rule, split: splitCommission(dto.amount, rule) };
    });
  }
}

@Module({ controllers: [CommissionRulesController] })
export class CommissionRulesModule {}
