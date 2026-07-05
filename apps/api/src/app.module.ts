import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core.module';
import { JwtAuthGuard } from './auth/jwt.guard';
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
import { WebhooksModule } from './modules/webhooks';

@Module({
  imports: [
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
    WebhooksModule,
  ],
  // JwtAuthGuard global: valida JWT + resolve tenant + checa @Roles.
  // Rotas @Public() (health, auth/login, webhooks) são liberadas.
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
