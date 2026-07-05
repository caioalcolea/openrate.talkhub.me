import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CoreModule } from './core.module';
import { JwtAuthGuard } from './auth/jwt.guard';
import { AuditInterceptor } from './common/audit.interceptor';
import { HealthModule } from './modules/health';
import { AuthModule } from './modules/auth';
import { OrgsModule } from './modules/orgs';
import { StoresModule } from './modules/stores';
import { UsersModule } from './modules/users';
import { ProductsModule } from './modules/products';
import { CatalogModule } from './modules/catalog';
import { MediaModule } from './modules/media';
import { IdeasModule } from './modules/ideas';
import { VideosModule } from './modules/videos';
import { GoalsModule } from './modules/goals';
import { NotificationsModule } from './modules/notifications';
import { CommissionRulesModule } from './modules/commission-rules';
import { PublicationsModule } from './modules/publications';
import { SalesModule } from './modules/sales';
import { SettlementsModule } from './modules/settlements';
import { PayoutsModule } from './modules/payouts';
import { DashboardModule } from './modules/dashboard';
import { CustomersModule } from './modules/customers';
import { StoreSalesModule } from './modules/store-sales';
import { AuditModule } from './modules/audit';
import { IntegrationsModule } from './modules/integrations';
import { WebhooksModule } from './modules/webhooks';

@Module({
  imports: [
    // Rate limit global (in-memory; API é single-replica). Default generoso;
    // as rotas públicas de auth têm limites bem mais estritos (@Throttle) contra
    // brute-force/credential-stuffing e DoS de scrypt.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    CoreModule,
    HealthModule,
    AuthModule,
    OrgsModule,
    StoresModule,
    UsersModule,
    ProductsModule,
    CatalogModule,
    MediaModule,
    IdeasModule,
    VideosModule,
    GoalsModule,
    NotificationsModule,
    CommissionRulesModule,
    PublicationsModule,
    SalesModule,
    SettlementsModule,
    PayoutsModule,
    DashboardModule,
    CustomersModule,
    StoreSalesModule,
    AuditModule,
    IntegrationsModule,
    WebhooksModule,
  ],
  providers: [
    // ThrottlerGuard primeiro: limita por IP ANTES de qualquer processamento caro.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JwtAuthGuard global: valida JWT + resolve tenant + checa @Roles.
    // Rotas @Public() (health, auth/login, webhooks) são liberadas.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // AuditInterceptor global: registra em audit_log toda mutação bem-sucedida.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
