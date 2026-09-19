import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { PrismaService, isUuid } from '../prisma/prisma.service';

/** Validates `Authorization: Bearer <jwt>` and loads the merchant; `sub` is the merchant id. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.env.JWT_SECRET,
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<MerchantRow> {
    const merchant =
      typeof payload.sub === 'string' && isUuid(payload.sub)
        ? await this.prisma.merchant.findUnique({ where: { id: payload.sub } })
        : null;
    if (!merchant) throw new UnauthorizedException();
    return merchant;
  }
}
