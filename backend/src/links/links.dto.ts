import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, Validate, ValidatorConstraint } from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';
import type {
  GetLinksQuery,
  LinkStatus,
  OnchainInvoice,
  Payment,
  PaymentLink,
  PostLinksRequest,
} from '../contract/api.types';
import { PageQueryDto } from '../common/pagination.dto';
import { isValidLinkAmountTRY } from '../common/money';

export const LINK_STATUSES: readonly LinkStatus[] = ['open', 'underpaid', 'paid', 'expired', 'cancelled'];

@ValidatorConstraint({ name: 'linkAmountTRY' })
class LinkAmountTRY implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidLinkAmountTRY(value);
  }
  defaultMessage(): string {
    return 'amountTRY must be a decimal string with exactly 2 dp (^\\d+\\.\\d{2}$), 1.00–1000000.00';
  }
}

export class CreateLinkDto implements PostLinksRequest {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Decimal string, exactly 2 dp, 1.00–1000000.00. Locked at creation. */
  @Validate(LinkAmountTRY)
  amountTRY!: string;

  /** Whole hours; default LINK_DEFAULT_EXPIRY_HOURS (24). */
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInHours?: number;
}

export class LinksQueryDto extends PageQueryDto implements GetLinksQuery {
  @IsOptional()
  @IsIn(LINK_STATUSES)
  status?: LinkStatus;
}

// Response schemas for Swagger; the controllers return the contract types.

export class PaymentDto implements Payment {
  id!: string;
  linkId!: string;
  rail!: Payment['rail'];
  txHash!: string;
  payerAddress!: string;
  amountUSDC!: string;
  ledger!: number;
  explorerUrl!: string;
  detectedAt!: string;
}

export class OnchainInvoiceDto implements OnchainInvoice {
  contractId!: string;
  invoiceCode!: string;
  deadlineLedger!: number;
  txHash?: string;
}

export class PaymentLinkDto implements PaymentLink {
  id!: string;
  code!: string;
  merchantId!: string;
  merchantName!: string;
  title!: string;
  description?: string;
  /** Decimal string, 2 dp. What the merchant is owed; locked at creation. */
  amountTRY!: string;
  /** Decimal string, 7 dp. What the payer sends; locked at creation. */
  quotedUSDC!: string;
  /** TRY per USDC at quote time, spread included. Locked. */
  fxRate!: string;
  /** When that rate was fetched from its source. */
  fxRateAt!: string;
  /** Share of each USDC the source keeps as spread, 7 dp (e.g. "0.0050237"); null if not stated. */
  fxSpread!: string | null;
  /** === expiresAt, always: quotes are never re-quoted. */
  quoteExpiresAt!: string;
  status!: LinkStatus;
  expiresAt!: string;
  payUrl!: string;
  receivedUSDC!: string;
  shortfallUSDC?: string;
  payment?: PaymentDto;
  payments!: PaymentDto[];
  onchain!: OnchainInvoiceDto | null;
  createdAt!: string;
}

export class PaginatedLinksDto {
  items!: PaymentLinkDto[];
  total!: number;
}
