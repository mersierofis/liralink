import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorFilter } from './common/api-error.filter';
import { AppConfig } from './config/app-config';

/** Everything main.ts applies to the app; e2e tests call it too, so they test the real wiring. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfig);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({ origin: config.env.CORS_ORIGINS });

  const doc = new DocumentBuilder()
    .setTitle('LiraLink API')
    .setDescription('Contract: docs/api.types.ts. Money is always a decimal string (TRY 2 dp, USDC 7 dp).')
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc));
}
