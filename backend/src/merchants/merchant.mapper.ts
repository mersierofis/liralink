import type { Merchant } from '../contract/api.types';
import type { AppConfig } from '../config/app-config';
import type { Merchant as MerchantRow } from '../generated/prisma/client';
import { formatUSDC } from '../common/money';

/** The merchant's own profile. The IBAN is full here, and only here. */
export function toMerchant(row: MerchantRow, config: AppConfig): Merchant {
  return {
    id: row.id,
    email: row.email,
    businessName: row.businessName,
    ...(row.iban !== null && { iban: row.iban }),
    autoSavePercent: row.autoSavePercent,
    unallocatedUSDC: formatUSDC(row.unallocatedUSDC),
    settlementMode: config.settlementMode,
    createdAt: row.createdAt.toISOString(),
  };
}
