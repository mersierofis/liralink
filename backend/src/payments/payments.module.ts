import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentEvents } from './payment-events';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [PaymentEvents, PaymentsService],
  exports: [PaymentsService, PaymentEvents],
})
export class PaymentsModule {}
