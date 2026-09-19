import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PaymentsModule } from '../payments/payments.module';
import { HorizonListenerService } from './horizon-listener.service';

@Module({
  imports: [ConfigModule, PaymentsModule],
  providers: [HorizonListenerService],
  exports: [HorizonListenerService],
})
export class StellarModule {}
