import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Merchant as MerchantRow } from '../generated/prisma/client';

/** The authenticated merchant's database row, set by JwtStrategy. Use behind JwtAuthGuard only. */
export const CurrentMerchant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MerchantRow => ctx.switchToHttp().getRequest<Request>().user as MerchantRow,
);
