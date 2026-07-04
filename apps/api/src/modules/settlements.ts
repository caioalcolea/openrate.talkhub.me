import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import {
  closeSettlementSchema,
  type CloseSettlementInput,
  type TenantContext,
} from '@openrate/shared';
import { CurrentTenant } from '../common/tenant';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Roles } from '../auth/roles.decorator';
import { QueuesService } from '../queues.service';

@Controller('settlements')
class SettlementsController {
  constructor(private readonly queues: QueuesService) {}

  // Dispara o fechamento do período (consolida comissões due em payouts).
  // Idempotente no worker: reexecutar o mesmo período não duplica payouts.
  @Post('close')
  @Roles('owner')
  @HttpCode(202)
  async close(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(closeSettlementSchema)) dto: CloseSettlementInput,
  ): Promise<{ period: string; status: string }> {
    if (!t.orgId) throw new Error('org ausente');
    await this.queues.enqueueCommissionSettlement({
      orgId: t.orgId,
      correlationId: t.correlationId,
      period: dto.period,
    });
    return { period: dto.period, status: 'queued' };
  }
}

@Module({ controllers: [SettlementsController] })
export class SettlementsModule {}
