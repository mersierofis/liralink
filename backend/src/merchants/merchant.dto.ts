import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Merchant, PatchMeRequest, SettlementMode } from '../contract/api.types';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN } from '../auth/auth.dto';

/** The merchant's own profile, with the full IBAN. Only ever returned to that merchant. */
export class MerchantDto implements Merchant {
  id!: string;
  email!: string;
  businessName!: string;
  /** Full IBAN, ^TR\d{24}$. */
  iban?: string;
  autoSavePercent!: number;
  /** Decimal string, 7 dp. */
  unallocatedUSDC!: string;
  settlementMode!: SettlementMode;
  createdAt!: string;
}

/** PATCH /me. A password change needs both currentPassword and newPassword. */
export class PatchMeDto implements PatchMeRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  businessName?: string;

  /** Full IBAN, ^TR\d{24}$, no spaces. */
  @IsOptional()
  @IsString()
  @Matches(/^TR\d{24}$/, { message: 'iban must match ^TR\\d{24}$' })
  iban?: string;

  /** 0–50. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  autoSavePercent?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;

  /** 8+ characters, at most 72 bytes. */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX_BYTES)
  newPassword?: string;
}
