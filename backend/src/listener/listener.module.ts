import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { ListenerService } from './listener.service';
import { PaymentEvents } from './payment-events';
import { PaymentProcessor } from './payment-processor';
import { HorizonPaymentSource, PAYMENT_SOURCE } from './payment-source';

@Module({
  providers: [
    PaymentEvents,
    PaymentProcessor,
    ListenerService,
    {
      provide: PAYMENT_SOURCE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new HorizonPaymentSource(config.env.HORIZON_URL, config.platformAccount),
    },
  ],
  exports: [ListenerService, PaymentEvents],
})
export class ListenerModule {}
