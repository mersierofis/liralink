import { Module } from '@nestjs/common';
import { ListenerModule } from '../listener/listener.module';
import { HealthController } from './health.controller';

@Module({ imports: [ListenerModule], controllers: [HealthController] })
export class HealthModule {}
