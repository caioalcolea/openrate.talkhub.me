import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { CurrentTenant, Public } from '../common/tenant';
import { PgService } from '../common/pg.service';
import { env } from '../common/env';
import type { TenantContext } from '@openrate/shared';

interface LoginDto {
  email?: string;
  password?: string;
}
interface RefreshDto {
  refresh_token?: string;
}

// Proxy fino para o gotrue (padroniza erros); a API nunca emite token próprio.
@Controller('auth')
class AuthController {
  constructor(private readonly pg: PgService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto): Promise<unknown> {
    if (!body.email || !body.password) throw new UnauthorizedException('email/senha obrigatórios');
    try {
      const res = await axios.post(
        `${env.supabaseUrl}/auth/v1/token?grant_type=password`,
        { email: body.email, password: body.password },
        { headers: { apikey: env.supabaseAnonKey, 'Content-Type': 'application/json' } },
      );
      return res.data;
    } catch {
      throw new UnauthorizedException('credenciais inválidas');
    }
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: RefreshDto): Promise<unknown> {
    if (!body.refresh_token) throw new UnauthorizedException('refresh_token obrigatório');
    try {
      const res = await axios.post(
        `${env.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        { refresh_token: body.refresh_token },
        { headers: { apikey: env.supabaseAnonKey, 'Content-Type': 'application/json' } },
      );
      return res.data;
    } catch {
      throw new UnauthorizedException('refresh inválido');
    }
  }
}

@Controller()
class MeController {
  constructor(private readonly pg: PgService) {}

  @Get('me')
  async me(@CurrentTenant() t: TenantContext): Promise<unknown> {
    return this.pg.withTenant(t, async (c) => {
      const user = await c.query(
        'SELECT id, email, full_name, role, phone, image_release_status FROM openrate.users WHERE id = $1',
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
}

@Module({ controllers: [AuthController, MeController] })
export class AuthModule {}
