import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Module,
  Post,
} from '@nestjs/common';
import { Public } from '../common/tenant';
import { env } from '../common/env';

// Webhooks de terceiros — autenticados por segredo próprio, nunca por JWT.
// A validação de assinatura completa (Asaas/Docuseal) e a dedupe por event id
// entram junto com as filas payout-pix (Sprint 5+) e o gate Docuseal.
@Controller('webhooks')
class WebhooksController {
  @Public()
  @Post('asaas')
  asaas(@Headers('asaas-access-token') token: string, @Body() body: unknown): { ok: boolean } {
    if (env.asaasWebhookToken && token !== env.asaasWebhookToken) {
      throw new ForbiddenException('token inválido');
    }
    // TODO(Sprint 5): dedupe por event id + transição de payout (TRANSFER_DONE/FAILED).
    return { ok: true };
  }

  @Public()
  @Post('docuseal')
  docuseal(@Headers('x-docuseal-token') token: string, @Body() body: unknown): { ok: boolean } {
    if (env.docusealWebhookToken && token !== env.docusealWebhookToken) {
      throw new ForbiddenException('token inválido');
    }
    // TODO(fase Escala): marcar users.image_release_signed_at e liberar publicação.
    return { ok: true };
  }
}

@Module({ controllers: [WebhooksController] })
export class WebhooksModule {}
