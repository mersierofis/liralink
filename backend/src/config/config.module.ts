import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from './app-config';
import { envSchema, validateEnv, type Env } from './env';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      validate: validateEnv,
      // Tests configure the process environment themselves and never read a developer's .env.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
  ],
  providers: [
    {
      provide: AppConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AppConfig(Object.fromEntries(Object.keys(envSchema.shape).map((k) => [k, config.get(k)])) as Env),
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
