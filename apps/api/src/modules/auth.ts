import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { CurrentTenant, Public } from '../common/tenant';
import { PgService } from '../common/pg.service';
import { ZodValidationPipe } from '../common/zod.pipe';
import { env } from '../common/env';
import { hashPassword, verifyPassword } from '../common/password';
import {
  OPENRATE_PRODUCT,
  updatePixSchema,
  changePasswordSchema,
  type UpdatePixInput,
  type ChangePasswordInput,
  type TenantContext,
} from '@openrate/shared';

interface LoginDto {
  email?: string;
  password?: string;
}
interface RefreshDto {
  refresh_token?: string;
}
interface BootstrapDto {
  email?: string;
  password?: string;
  fullName?: string;
}
interface SwitchOrgDto {
  orgId?: string;
}

interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  organization_id: string | null;
  store_id: string | null;
  role: string;
  full_name: string;
  active: boolean;
}

type Principal = {
  id: string;
  email: string;
  organization_id: string | null;
  store_id: string | null;
  role: string;
};

const ACCESS_TTL_SECONDS = 12 * 60 * 60; // 12h
const REFRESH_TTL = '30d';

function appMetadata(p: Principal) {
  return {
    product: OPENRATE_PRODUCT,
    org_id: p.organization_id,
    store_id: p.store_id,
    role: p.role,
  };
}

function session(p: Principal) {
  // email é opcional no jwtClaimsSchema, mas se presente precisa ser um e-mail VÁLIDO
  // (senão o guard rejeita). Só o incluímos quando não-vazio.
  const emailClaim = p.email ? { email: p.email } : {};
  const access_token = jwt.sign(
    { sub: p.id, ...emailClaim, app_metadata: appMetadata(p) },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS },
  );
  const refresh_token = jwt.sign(
    { sub: p.id, ...emailClaim, typ: 'refresh', app_metadata: appMetadata(p) },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: REFRESH_TTL },
  );
  return {
    access_token,
    refresh_token,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    user: { id: p.id, email: p.email, role: p.role, org_id: p.organization_id, store_id: p.store_id },
  };
}

// Auth PRÓPRIA do OpenRate: a API valida a senha (scrypt) contra openrate.users
// e emite o próprio JWT HS256 (assinado com JWT_SECRET). O shape de claims é o que
// o JwtAuthGuard e as policies RLS esperam.
@Controller('auth')
class AuthController {
  constructor(private readonly pg: PgService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto): Promise<unknown> {
    if (!body.email || !body.password) throw new UnauthorizedException('email/senha obrigatórios');
    // auth_find_user é SECURITY DEFINER: resolve por e-mail sem claim de tenant (pré-login).
    const r = await this.pg.query<AuthUserRow>('SELECT * FROM openrate.auth_find_user($1)', [
      body.email,
    ]);
    const u = r.rows[0];
    if (!u || !u.active) throw new UnauthorizedException('credenciais inválidas');
    if (!(await verifyPassword(body.password, u.password_hash))) {
      throw new UnauthorizedException('credenciais inválidas');
    }
    return session(u);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: RefreshDto): Promise<unknown> {
    if (!body.refresh_token) throw new UnauthorizedException('refresh_token obrigatório');
    let d: {
      sub?: string;
      email?: string;
      typ?: string;
      app_metadata?: { org_id?: string | null; store_id?: string | null; role?: string };
    };
    try {
      d = jwt.verify(body.refresh_token, env.jwtSecret, { algorithms: ['HS256'] }) as typeof d;
    } catch {
      throw new UnauthorizedException('refresh inválido');
    }
    if (!d || d.typ !== 'refresh' || !d.sub || !d.app_metadata?.role) {
      throw new UnauthorizedException('refresh inválido');
    }
    const access_token = jwt.sign(
      {
        sub: d.sub,
        email: d.email,
        app_metadata: {
          product: OPENRATE_PRODUCT,
          org_id: d.app_metadata.org_id ?? null,
          store_id: d.app_metadata.store_id ?? null,
          role: d.app_metadata.role,
        },
      },
      env.jwtSecret,
      { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS },
    );
    return { access_token, token_type: 'bearer', expires_in: ACCESS_TTL_SECONDS };
  }

  // Primeiro acesso: cria o super_admin inicial (organization_id NULL). A função
  // bootstrap_super_admin AUTO-DESABILITA após o 1º — chamadas seguintes dão 409.
  @Public()
  @Post('bootstrap')
  async bootstrap(@Body() body: BootstrapDto): Promise<unknown> {
    if (!body.email || !body.password || !body.fullName) {
      throw new UnauthorizedException('email, password e fullName obrigatórios');
    }
    if (body.password.length < 8) {
      throw new ForbiddenException('senha muito curta (mínimo 8 caracteres)');
    }
    const hash = await hashPassword(body.password);
    let id: string;
    try {
      const r = await this.pg.query<{ id: string }>(
        'SELECT openrate.bootstrap_super_admin($1,$2,$3) AS id',
        [body.email, body.fullName, hash],
      );
      id = r.rows[0].id;
    } catch {
      throw new ConflictException('bootstrap indisponível: já existe um super_admin');
    }
    return session({ id, email: body.email, organization_id: null, store_id: null, role: 'super_admin' });
  }

  // "Act-as-org": re-emite o JWT com a org escolhida. super_admin entra em QUALQUER
  // org; os demais papéis só na própria (senão 403). É o que dá contexto de tenant a
  // um super_admin (que nasce com org_id null) para operar dentro de uma organização.
  @Post('switch-org')
  async switchOrg(@CurrentTenant() t: TenantContext, @Body() body: SwitchOrgDto): Promise<unknown> {
    if (!body.orgId) throw new BadRequestException('orgId obrigatório');
    if (t.role !== 'super_admin' && t.orgId !== body.orgId) {
      throw new ForbiddenException('sem acesso a esta organização');
    }
    // Sob o RLS do próprio usuário: super_admin vê todas (super_admin_all), owner/manager
    // veem a própria (org_self_read); self_read garante ler o próprio e-mail.
    const found = await this.pg.withTenant(t, async (c) => {
      const org = (
        await c.query<{ id: string }>('SELECT id FROM openrate.organizations WHERE id = $1', [
          body.orgId,
        ])
      ).rows[0];
      const me = (
        await c.query<{ email: string }>('SELECT email FROM openrate.users WHERE id = $1', [t.userId])
      ).rows[0];
      return { org, email: me?.email };
    });
    if (!found.org) throw new NotFoundException('organização não encontrada');
    return session({
      id: t.userId,
      email: found.email ?? '',
      organization_id: body.orgId,
      // super_admin entra na org sem escopo de loja (visão org-wide, por design).
      // Os demais papéis PRESERVAM seu store_id: sem isso, um manager de loja se
      // re-emitiria um token sem escopo e veria agregados de toda a organização.
      store_id: t.role === 'super_admin' ? null : t.storeId,
      role: t.role,
    });
  }

  // Troca de senha do próprio usuário. No 1º acesso (must_change_password=true) não
  // exige a senha atual; depois disso, exige e valida a atual.
  @Post('change-password')
  async changePassword(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordInput,
  ): Promise<{ ok: true }> {
    return this.pg.withTenant(t, async (c) => {
      const r = await c.query<{ password_hash: string | null; must_change_password: boolean }>(
        'SELECT password_hash, must_change_password FROM openrate.users WHERE id = $1',
        [t.userId],
      );
      const u = r.rows[0];
      if (!u) throw new UnauthorizedException('usuário não encontrado');
      if (!u.must_change_password) {
        if (!dto.currentPassword || !(await verifyPassword(dto.currentPassword, u.password_hash))) {
          throw new UnauthorizedException('senha atual incorreta');
        }
      }
      const hash = await hashPassword(dto.newPassword);
      await c.query(
        'UPDATE openrate.users SET password_hash = $2, must_change_password = false WHERE id = $1',
        [t.userId, hash],
      );
      return { ok: true };
    });
  }
}

@Controller()
class MeController {
  constructor(private readonly pg: PgService) {}

  @Get('me')
  async me(@CurrentTenant() t: TenantContext): Promise<unknown> {
    return this.pg.withTenant(t, async (c) => {
      const user = await c.query(
        'SELECT id, email, full_name, role, phone, image_release_status, must_change_password FROM openrate.users WHERE id = $1',
        [t.userId],
      );
      const org = t.orgId
        ? await c.query('SELECT id, name, slug FROM openrate.organizations WHERE id = $1', [t.orgId])
        : null;
      const store = t.storeId
        ? await c.query('SELECT id, name FROM openrate.stores WHERE id = $1', [t.storeId])
        : null;
      return {
        user: user.rows[0] ?? { id: t.userId, role: t.role },
        org: org?.rows[0] ?? null,
        store: store?.rows[0] ?? null,
        role: t.role,
      };
    });
  }

  // O próprio usuário cadastra/edita sua chave Pix (dado sensível do recebedor).
  @Patch('me/pix')
  updatePix(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(updatePixSchema)) dto: UpdatePixInput,
  ) {
    return this.pg.withTenant(t, (c) =>
      c
        .query(
          `UPDATE openrate.users SET pix_key = $2, pix_key_type = $3, cpf = COALESCE($4, cpf)
             WHERE id = $1 RETURNING id, pix_key, pix_key_type`,
          [t.userId, dto.pixKey, dto.pixKeyType, dto.cpf ?? null],
        )
        .then((r) => r.rows[0] ?? null),
    );
  }
}

@Module({ controllers: [AuthController, MeController] })
export class AuthModule {}
