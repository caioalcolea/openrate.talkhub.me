import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { TenantContext } from '@openrate/shared';
import { PgService } from './pg.service';
import type { RequestWithTenant } from './tenant';

// Só mutações autenticadas são auditadas (GET não muda estado; rotas @Public não
// têm tenant e ficam de fora — nunca logamos credenciais de login/refresh).
const AUDIT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// Recursos de altíssima frequência e baixo valor de auditoria (ruído puro).
const SKIP_RESOURCES = new Set(['notifications']);
// Redação de campos sensíveis no snapshot do corpo — credenciais e PII financeira.
const REDACT = /(pass|senha|token|secret|hash|pix|cpf|cnpj|document|chave|account|conta|iban|card|cart[aã]o)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

// Deriva "recurso.verbo" do path da rota (sem o prefixo /v1). Ex.:
//   POST  /videos/:id/approve -> { videos, videos.approve }
//   PATCH /products/:id       -> { products, products.update }
//   POST  /affiliate-sales    -> { affiliate-sales, affiliate-sales.create }
function deriveAction(method: string, routePath: string): { resource: string; action: string } {
  const clean = routePath.replace(/^\/+/, '').replace(/^v1\//, '');
  const segs = clean.split('/').filter((s) => s.length > 0);
  const resource = segs[0] ?? 'root';
  const last = segs[segs.length - 1] ?? '';
  const verbByMethod: Record<string, string> = {
    POST: 'create',
    PATCH: 'update',
    PUT: 'update',
    DELETE: 'delete',
  };
  // Último segmento sendo um verbo de ação (não um :param nem só o recurso) → usa-o.
  const isParam = last.startsWith(':');
  const verb = isParam || segs.length <= 1 ? (verbByMethod[method] ?? method.toLowerCase()) : last;
  return { resource, action: `${resource}.${verb}` };
}

// Registra em openrate.audit_log toda mutação bem-sucedida. É best-effort e roda
// FORA do caminho crítico: uma falha de auditoria nunca derruba a operação.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly pg: PgService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithTenant>();
    const method = req.method;
    const tenant = req.tenant;
    const auditable = AUDIT_METHODS.has(method) && !!tenant;

    return next.handle().pipe(
      tap((data) => {
        if (!auditable || !tenant) return;
        const routePath = (req.route?.path as string | undefined) ?? req.path;
        const { resource, action } = deriveAction(method, routePath);
        if (SKIP_RESOURCES.has(resource)) return;
        // id do recurso: do path (:id) ou, em creates, do id retornado na resposta.
        const entityId =
          (req.params?.id as string | undefined) ??
          (data && typeof data === 'object' && 'id' in data ? String((data as { id: unknown }).id) : null);

        void this.write(tenant, {
          action,
          entityType: resource,
          entityId,
          newData: redact(req.body),
          ip: typeof req.ip === 'string' ? req.ip : null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        });
      }),
    );
  }

  private async write(
    t: TenantContext,
    e: {
      action: string;
      entityType: string;
      entityId: string | null;
      newData: unknown;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<void> {
    try {
      await this.pg.withTenant(t, (c) =>
        c.query(
          `INSERT INTO openrate.audit_log
             (organization_id, user_id, action, entity_type, entity_id, new_data, ip, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            t.orgId,
            t.userId,
            e.action,
            e.entityType,
            e.entityId,
            e.newData === undefined ? null : JSON.stringify(e.newData),
            e.ip,
            e.userAgent,
          ],
        ),
      );
    } catch {
      // auditoria é complementar; a falha de log não afeta a operação já commitada.
    }
  }
}
