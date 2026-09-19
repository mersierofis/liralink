import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

/** JWT lifetime 7 d (01-BACKEND.md). */
const JWT_LIFETIME = '7d';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: JWT_LIFETIME },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
