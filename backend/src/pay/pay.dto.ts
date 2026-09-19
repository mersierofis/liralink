import { Matches } from 'class-validator';
import type { GetPayStatusResponse, LinkStatus, PayQuote, PostPaySubmittedRequest, PostPaySubmittedResponse } from '../contract/api.types';
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
  /** The locked rate, spread included. */
  fxRate!: string;
  /** When that rate was fetched. */
  fxRateAt!: string;
  /** The spread in that rate, 7 dp; null if not stated. */
  fxSpread!: string | null;
  /** === expiresAt, always. */
  quoteExpiresAt!: string;
  /** 'expired' once past expiresAt: the payer asks the merchant for a new link. */
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

/** Swagger schema for GET /pay/:code/status. */
export class PayStatusDto implements GetPayStatusResponse {
  status!: LinkStatus;
  receivedUSDC!: string;
  shortfallUSDC?: string;
  payment?: PaymentDto;
  payments!: PaymentDto[];
}

/** POST /pay/:code/submitted body. */
export class PaySubmittedDto implements PostPaySubmittedRequest {
  /** The transaction the payer just submitted: 64 hex characters. */
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'txHash must be 64 hex characters' })
  txHash!: string;
}

export class PaySubmittedResponseDto implements PostPaySubmittedResponse {
  accepted!: true;
}
