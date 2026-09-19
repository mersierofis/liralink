import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const config = app.get(AppConfig);
  await app.listen(config.env.PORT);
  Logger.log(`API on :${config.env.PORT}/api · Swagger /docs · platform account ${config.platformAccount}`, 'Bootstrap');
}

void bootstrap();
