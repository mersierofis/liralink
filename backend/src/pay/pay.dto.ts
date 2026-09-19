import type { LinkStatus, PayQuote } from '../contract/api.types';
import { PaymentDto } from '../links/links.dto';

class ContractRailDto {
  contractId!: string;
  invoiceCode!: string;
}
class MemoRailDto {
  destination!: string;
  memo!: string;
}
class RailsDto {
  contract?: ContractRailDto;
  memo!: MemoRailDto;
}
class AssetDto {
  code!: 'USDC';
  issuer!: string;
}

/** Swagger schema for GET /pay/:code. */
export class PayQuoteDto implements PayQuote {
  code!: string;
  merchantName!: string;
  title!: string;
  description?: string;
  amountTRY!: string;
  /** The link's locked quotedUSDC: what the payer must send. */
  amountUSDC!: string;
  fxRate!: string;
  quoteExpiresAt!: string;
  status!: LinkStatus;
  expiresAt!: string;
  receivedUSDC!: string;
  shortfallUSDC?: string;
  rails!: RailsDto;
  asset!: AssetDto;
  network!: 'testnet';
  payment?: PaymentDto;
  payments!: PaymentDto[];
}
