import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { LinksModule } from '../links/links.module';
import { ListenerModule } from '../listener/listener.module';
import { PayController } from './pay.controller';
import { PaymentNudge } from './payment-nudge';

@Module({ imports: [LinksModule, ListenerModule, InvoiceModule], controllers: [PayController], providers: [PaymentNudge] })
export class PayModule {}
