import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { FxModule } from './fx/fx.module';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { MerchantsModule } from './merchants/merchants.module';
import { PayModule } from './pay/pay.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { StellarModule } from './stellar/stellar.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    FxModule,
    AuthModule,
    MerchantsModule,
    LinksModule,
    PayModule,
    PaymentsModule,
    StellarModule,
    HealthModule,
  ],
})
export class AppModule {}
