import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Module,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/tenant';
import { env } from '../common/env';

// Fail-closed: sem token configurado o webhook NÃO aceita nada (evita fail-open).
// Comparação em tempo constante (evita timing oracle sobre o segredo do webhook).
function checkToken(configured: string, received: string | undefined): void {
  if (!configured) throw new ServiceUnavailableException('webhook não configurado');
  const a = Buffer.from(received ?? '');
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('token inválido');
}

// Webhooks de terceiros — autenticados por segredo próprio, nunca por JWT.
// A validação de assinatura completa (Asaas/Docuseal) e a dedupe por event id
// entram junto com as filas payout-pix (Sprint 5+) e o gate Docuseal.
@Controller('webhooks')
class WebhooksController {
  @Public()
  @Post('asaas')
  asaas(@Headers('asaas-access-token') token: string, @Body() _body: unknown): { ok: boolean } {
    checkToken(env.asaasWebhookToken, token);
    // Fase Escala (payout automático): dedupe por event id + transição de
    // payout (TRANSFER_DONE/FAILED). No MVP o payout é registrado manualmente.
    return { ok: true };
  }

  @Public()
  @Post('docuseal')
  docuseal(@Headers('x-docuseal-token') token: string, @Body() _body: unknown): { ok: boolean } {
    checkToken(env.docusealWebhookToken, token);
    // Fase Escala: marcar users.image_release_signed_at e liberar publicação.
    return { ok: true };
  }
}

@Module({ controllers: [WebhooksController] })
export class WebhooksModule {}
