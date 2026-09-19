import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashSync } from 'bcryptjs';
import type {
  JwtPayload,
  PostAuthLoginRequest,
  PostAuthLoginResponse,
  PostAuthRegisterRequest,
  PostAuthRegisterResponse,
} from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { toMerchant } from '../merchants/merchant.mapper';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service';
import { fitsBcrypt, hashPassword, verifyPassword } from './passwords';

/** Compared against when the email is unknown, so a miss costs the same time as a wrong password. */
const DUMMY_HASH = hashSync('liralink-no-such-merchant', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async register(body: PostAuthRegisterRequest): Promise<PostAuthRegisterResponse> {
    if (!fitsBcrypt(body.password)) throw new BadRequestException(['password must be at most 72 bytes']);
    try {
      const row = await this.prisma.merchant.create({
        data: {
          email: normalizeEmail(body.email),
          passwordHash: await hashPassword(body.password),
          businessName: body.businessName.trim(),
        },
      });
      return this.session(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Email is already registered');
      throw err;
    }
  }

  async login(body: PostAuthLoginRequest): Promise<PostAuthLoginResponse> {
    const row = await this.prisma.merchant.findUnique({ where: { email: normalizeEmail(body.email) } });
    const ok = await verifyPassword(body.password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.session(row);
  }

  private async session(row: MerchantRow): Promise<PostAuthLoginResponse> {
    const payload: Pick<JwtPayload, 'sub'> = { sub: row.id };
    return { token: await this.jwt.signAsync(payload), merchant: toMerchant(row, this.config) };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
