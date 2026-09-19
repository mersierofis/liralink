import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';

@Module({ imports: [InvoiceModule], controllers: [LinksController], providers: [LinksService], exports: [LinksService] })
export class LinksModule {}
