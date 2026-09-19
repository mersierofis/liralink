import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MerchantsService } from './merchants.service';

@Module({ controllers: [MeController], providers: [MerchantsService] })
export class MerchantsModule {}
