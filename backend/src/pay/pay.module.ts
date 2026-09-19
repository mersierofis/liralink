import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { PayController } from './pay.controller';

@Module({ imports: [LinksModule], controllers: [PayController] })
export class PayModule {}
