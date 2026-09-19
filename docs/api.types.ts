// LiraLink API contract (v1) — the single source of truth for request and response shapes.
//
// Derived from docs/00-PROJECT.md §5 (domain model) and §6 (API contract); anchor codes from
// docs/anchor.md. If this file and 00-PROJECT.md disagree, fix 00-PROJECT.md first, then this file.
// merchant-web and pay-web commit a byte-identical copy. Types only: no runtime code, no imports.
//
// Rules:
// - All money fields are decimal STRINGS, never numbers. TRY has 2 dp, USDC has 7 dp, always
//   written out in full, zero included ("0.0000000"). The unit is in the field name: amountTRY,
//   quotedUSDC, receivedUSDC, netTRY, feeUSDC, ...
// - All timestamps are ISO 8601 strings in UTC. (JWT `iat`/`exp` are the one exception: JWT
//   NumericDate, seconds since the epoch.)
// - IBAN visibility: a merchant sees their own IBAN in full, nobody else sees it at all. Only the
//   merchant's own profile (`Merchant`: GET/PATCH /me, register, login) carries the full IBAN.
//   Every other response and every log line carries it masked (`MaskedIban`), and nothing the
//   payer can see carries it at all. Requests carry the full IBAN, ^TR\d{24}$, no spaces.
// - Base path `/api`. All bodies are JSON. Merchant endpoints need `Authorization: Bearer <jwt>`;
//   payer (`/pay/...`) and system endpoints are public.
// - Every non-2xx response body is an `ApiError`.
//
// OPEN: fields marked `?` — the doc does not say whether "not set" is an absent key or `null`
// (Prisma rows hold `null`). Consumers should treat both as "not set" until this is decided.

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** Decimal string, 2 dp, e.g. "5000.00". */
export type DecimalTRY = string;
/** Decimal string, always 7 dp, zero included: "147.0588235", "0.0000000". */
export type DecimalUSDC = string;
/** TRY per 1 USDC, decimal string. */
export type FxRate = string; // OPEN: precision not fixed in 00-PROJECT.md (anchor.md: anchor rates rounded down to 6 dp)
/** ISO 8601 UTC timestamp, e.g. "2026-09-19T10:00:00.000Z". */
export type IsoTimestamp = string;
/** Stellar account public key, "G…" (56 chars). */
export type StellarAccountId = string;
/** Soroban contract id, "C…" (56 chars). */
export type StellarContractId = string;
/** 64-hex Stellar transaction hash. */
export type TxHash = string;
/**
 * Masked IBAN, exactly this shape: "TR33 **** **** **** **** **26". The first 4 and the last 2
 * characters of the IBAN are visible, everything between is the fixed mask
 * "**** **** **** **** **" — the mask does not preserve the IBAN's length.
 */
export type MaskedIban = string;
/** Full IBAN: ^TR\d{24}$. In requests, and in the merchant's own profile only. */
export type Iban = string;

// ---------------------------------------------------------------------------------------------
// Status unions and enums
// ---------------------------------------------------------------------------------------------

export type LinkStatus = 'open' | 'underpaid' | 'paid' | 'expired' | 'cancelled';
export type PayRail = 'contract' | 'memo' | 'x402';
export type SettleStatus = 'pending' | 'processing' | 'completed' | 'failed';
/** TRY withdrawal to IBAN (balance mode only). */
export type WdStatus = 'requested' | 'processing' | 'completed' | 'failed';
/** USDC withdrawal to the merchant's own wallet. 'submitted' until the payment is on the ledger. */
export type UsdcWdStatus = 'submitted' | 'completed' | 'failed';
/** balance: TRY accrues, merchant withdraws (mock) · auto_payout: the anchor pays the IBAN at settlement (sep6/sep24). */
export type SettlementMode = 'balance' | 'auto_payout';
export type AnchorProvider = 'mock' | 'sep6' | 'sep24';
export type FxSource = 'mock' | 'live' | 'anchor';

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * Body of every non-2xx response.
 * 400 validation · 401 missing/invalid token · 403 wrong currentPassword · 404 unknown link/code ·
 * 409 invalid state transition, or not allowed in this settlement mode · 422 business rule
 * (insufficient balance, destination cannot receive USDC) · 503 dependency not configured / down.
 */
export interface ApiError {
  statusCode: number;
  message: string | string[];      // string[] for 400 validation errors (one entry per failed rule)
  error?: string;
}

/** Terminal settlement failures, never retried (00-PROJECT.md §5, anchor.md). */
export type SettleFailReason =
  | 'unexpected_fee_asset' // anchor reported neither a USDC fee nor a TRY amount_out, or a non-USDC fee (sep24)
  | 'invalid_fee'          // fee < 0 or > amountUSDC
  | 'anchor_status'        // anchor ended in error / expired / refunded / no_market / too_small / too_large
  | 'amount_mismatch';     // anchor amount_in != settlement amount; nothing was sent

/**
 * Anchor pre-check codes (anchor.md, SEP-6 flow steps 2, 4, 5). Not HTTP errors: the settlement
 * stays `pending` with this reason and the minute job retries.
 */
export type AnchorBlockedReason =
  | 'missing_iban'             // merchant has no IBAN, or the anchor rejected it over SEP-12
  | 'outside_anchor_limits'    // amount outside /info min/max, or an amount-shaped anchor 4xx
  | 'anchor_withdraw_disabled'; // /info shows USDC withdraw disabled

/** Why a USDC withdrawal failed; the amount is returned to its `source`. */
export type UsdcWdFailReason = 'failed_on_ledger' | 'expired_unsubmitted';

/** Soroban invoice contract errors (00-PROJECT.md §7). */
export type InvoiceContractError =
  | 1 // AlreadyExists
  | 2 // NotFound
  | 3 // NotPending
  | 4 // Expired
  | 5; // InvalidAmount

// ---------------------------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------------------------

/** The merchant's own profile. Only ever returned to that merchant. */
export interface Merchant {
  id: string;
  email: string;
  businessName: string;
  iban?: Iban;                     // full — the merchant's own IBAN (merchant-web prefills withdrawals from it)
  autoSavePercent: number;         // 0–50, default 0 — share of each payment kept in USDC
  unallocatedUSDC: DecimalUSDC;    // overpaid excess + stray payments, minus non-failed USDC withdrawals from it
  settlementMode: SettlementMode;  // derived from ANCHOR_PROVIDER
  createdAt: IsoTimestamp;
}

/** Present when the link was recorded as an on-chain invoice. */
export interface OnchainInvoice {
  contractId: StellarContractId;
  invoiceCode: string;
  deadlineLedger: number;          // ledger sequence
  txHash?: TxHash;
}

export interface PaymentLink {
  id: string;                      // uuid
  code: string;                    // 8 chars from ABCDEFGHJKLMNPQRSTUVWXYZ23456789, e.g. "K7Q2M9XA" — also the tx memo and the invoice code
  merchantId: string;
  merchantName: string;            // denormalized for the payer page
  title: string;                   // "Lemon order #1042"
  description?: string;
  amountTRY: DecimalTRY;           // locked at creation
  quotedUSDC: DecimalUSDC;         // locked at creation, never recomputed from what is received
  fxRate: FxRate;                  // at quote time
  quoteExpiresAt: IsoTimestamp;    // on-chain links: === expiresAt (locked); otherwise QUOTE_TTL_MINUTES and /pay re-quotes
  status: LinkStatus;
  expiresAt: IsoTimestamp;         // default +24 h
  payUrl: string;                  // PAY_WEB_BASE_URL + '/' + code
  receivedUSDC: DecimalUSDC;       // cumulative USDC matched so far, "0.0000000" until the first payment
  shortfallUSDC?: DecimalUSDC;     // only while status is 'underpaid'
  payment?: Payment;               // latest transfer — alias for payments.at(-1)
  payments: Payment[];             // every transfer that credited this link, oldest → newest
  onchain: OnchainInvoice | null;  // null if the best-effort invoice call failed
  createdAt: IsoTimestamp;
}

// OPEN: no Payment status is documented. A Payment row exists only once a transfer has credited
// a link (01-BACKEND.md: "one row per successful transfer"), so there is no status union to type.
export interface Payment {
  id: string;
  linkId: string;
  rail: PayRail;
  txHash: TxHash;
  payerAddress: StellarAccountId;
  amountUSDC: DecimalUSDC;
  ledger: number;                  // ledger sequence
  explorerUrl: string;
  detectedAt: IsoTimestamp;
}

export type PaymentAttemptReason =
  | 'link_not_open'    // the memo names a link that is paid, expired or cancelled
  | 'link_not_found'   // the memo is shaped like a link code, but no link has that code
  | 'unmatched_memo';  // no memo, or a memo that is not a link code

/**
 * A USDC payment to the platform account that did not become a `Payment` because it matched no
 * payable link. Never silently dropped: it creates a PaymentAttempt row and credits
 * `merchant.unallocatedUSDC`.
 * Design decision (2026-09-19), described in 00-PROJECT.md §4 and §5.
 */
export interface PaymentAttempt {
  id: string;
  linkCode: string | null;         // null when the memo is not a link code
  merchantId: string | null;       // null when no link, hence no merchant, matched. OPEN: whose unallocatedUSDC is credited when this is null is not decided
  txHash: TxHash;
  amountUSDC: DecimalUSDC;
  reason: PaymentAttemptReason;
  createdAt: IsoTimestamp;
}

export interface Settlement {
  id: string;
  merchantId: string;
  paymentId: string;
  amountUSDC: DecimalUSDC;         // USDC sent to the anchor (quotedUSDC − savedUSDC)
  amountTRY: DecimalTRY;           // gross: link.amountTRY × (100 − autoSavePercent)%
  fxRate: FxRate;                  // = link.fxRate
  savedUSDC: DecimalUSDC;          // auto-save portion kept in USDC
  feeUSDC: DecimalUSDC | null;     // anchor fee in USDC — null until completed; "0.0000000" when the anchor charges in TRY (anchor.md)
  netTRY: DecimalTRY | null;       // TRY credited (balance) or paid to the IBAN (auto_payout) — null until completed
  provider: AnchorProvider;        // the provider it was created with; it always continues on it
  status: SettleStatus;
  anchorRef?: string;              // the anchor's transaction id
  failReason: SettleFailReason | null;  // only when 'failed'
  blockedReason?: AnchorBlockedReason | null; // OPEN: stored per 01-BACKEND.md/anchor.md but not in the 00-PROJECT.md Settlement; exposure, and whether its redacted detail text is exposed, undecided
  interactiveUrl: string | null;   // sep24 only: the anchor's KYC page while it waits for the merchant; always null for sep6
  createdAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

/** TRY to IBAN, balance mode only. */
export interface Withdrawal {
  id: string;
  merchantId: string;
  amountTRY: DecimalTRY;
  iban: MaskedIban;                // masked in every response; the request carries the full IBAN
  status: WdStatus;
  anchorRef?: string;
  createdAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

/** USDC from the platform account to the merchant's own wallet. */
export interface UsdcWithdrawal {
  id: string;
  merchantId: string;
  amountUSDC: DecimalUSDC;
  destination: StellarAccountId;   // must exist and trust USDC
  source: 'saved' | 'unallocated'; // the balance debited when the request is accepted
  status: UsdcWdStatus;
  txHash: TxHash;                  // signed before submission, so present from the first response
  explorerUrl: string;
  failReason: UsdcWdFailReason | null;
  createdAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

export interface Balance {
  availableTRY: DecimalTRY;        // Σ netTRY of completed balance-mode settlements − Σ non-failed withdrawals
  pendingTRY: DecimalTRY;          // Σ amountTRY (gross) of pending/processing settlements
  savedUSDC: DecimalUSDC;          // Σ savedUSDC of non-failed settlements − Σ non-failed USDC withdrawals from 'saved'
  unallocatedUSDC: DecimalUSDC;    // stored counter, = Merchant.unallocatedUSDC
  paidOutTRY: DecimalTRY;          // Σ netTRY of completed auto_payout settlements; never withdrawable
}

/** What the payer page renders. */
export interface PayQuote {
  code: string;
  merchantName: string;
  title: string;
  description?: string;
  amountTRY: DecimalTRY;
  amountUSDC: DecimalUSDC;         // the link's quotedUSDC — what the payer must send (02-PAY-WEB.md)
  fxRate: FxRate;
  quoteExpiresAt: IsoTimestamp;
  status: LinkStatus;
  expiresAt: IsoTimestamp;
  receivedUSDC: DecimalUSDC;
  shortfallUSDC?: DecimalUSDC;     // only while status is 'underpaid'
  rails: {
    contract?: { contractId: StellarContractId; invoiceCode: string }; // present while the link is on-chain
    memo: { destination: StellarAccountId; memo: string };             // always present
  };
  asset: { code: 'USDC'; issuer: StellarAccountId };
  network: 'testnet';              // LiraLink's own name for the network; x402 fields use the x402 spec's 'stellar:testnet'
  payment?: Payment;
  payments: Payment[];
}

export interface UnallocatedCredit {
  id: string;
  source: 'stray' | 'overpaid';    // stray: payment to a link no longer payable, credited in full · overpaid: the excess on the completing payment
  txHash: TxHash;
  explorerUrl: string;
  amountUSDC: DecimalUSDC;
  linkCode: string;
  reason: string;
  createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------------------------
// Shared request/response helpers
// ---------------------------------------------------------------------------------------------

/** Query for every list endpoint. Lists are newest first. */
export interface PageQuery {
  page?: number;                   // 1-based, default 1
  limit?: number;                  // default 20, max 100
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------------------------------------
// Auth (merchant)
// ---------------------------------------------------------------------------------------------

/** Decoded payload of the bearer JWT. Lifetime 7 d (01-BACKEND.md). */
export interface JwtPayload {
  sub: string;                     // OPEN: JWT claims are not documented in 00-PROJECT.md; `sub` content (merchant id?) and any extra claims undecided
  iat: number;                     // seconds since epoch
  exp: number;                     // seconds since epoch
}

/** POST /auth/register → 201 */
export interface PostAuthRegisterRequest {
  email: string;
  password: string;                // OPEN: minimum length documented only for PATCH /me newPassword (≥ 8)
  businessName: string;
}
export interface PostAuthRegisterResponse {
  token: string;
  merchant: Merchant;
}

/** POST /auth/login → 200 */
export interface PostAuthLoginRequest {
  email: string;
  password: string;
}
export interface PostAuthLoginResponse {
  token: string;
  merchant: Merchant;
}

/** GET /me → 200 */
export type GetMeResponse = Merchant;

/**
 * PATCH /me → 200. A password change needs both currentPassword and newPassword (≥ 8 chars):
 * 400 if only one is sent, 403 if currentPassword is wrong.
 */
export interface PatchMeRequest {
  businessName?: string;
  iban?: Iban;
  autoSavePercent?: number;        // 0–50
  currentPassword?: string;
  newPassword?: string;
}
export type PatchMeResponse = Merchant;

// ---------------------------------------------------------------------------------------------
// Payment links (merchant)
// ---------------------------------------------------------------------------------------------

/**
 * POST /links → 201. Also creates the Soroban invoice, best-effort; if RPC fails the link is
 * still 201 with `onchain: null`.
 */
export interface PostLinksRequest {
  title: string;
  description?: string;
  amountTRY: DecimalTRY;           // ^\d+\.\d{2}$, 1.00–1000000.00
  expiresInHours?: number;         // default 24. OPEN: allowed range and integer-only not documented
}
export type PostLinksResponse = PaymentLink;

/** GET /links?status=&page=&limit= → 200 */
export interface GetLinksQuery extends PageQuery {
  status?: LinkStatus;
}
export type GetLinksResponse = Paginated<PaymentLink>;

/** GET /links/:id → 200 */
export type GetLinkResponse = PaymentLink;

/** POST /links/:id/cancel → 200. No body. Only if `open` (else 409); also cancels the on-chain invoice, best-effort. */
export type PostLinkCancelResponse = PaymentLink;

/**
 * POST /links/:id/onchain → 200 with `onchain` set. No body. Manual retry of the invoice call,
 * using the existing quotedUSDC. 409 unless `open` with nothing received; unchanged if already
 * on-chain; 503 if no contract is configured.
 */
export type PostLinkOnchainResponse = PaymentLink;

// ---------------------------------------------------------------------------------------------
// Money (merchant)
// ---------------------------------------------------------------------------------------------

/** GET /balance → 200 */
export type GetBalanceResponse = Balance;

/** One item of GET /payments. `link.*` are current values; `settlement` is null for installments that did not complete the link. */
export type PaymentWithLink = Payment & {
  link: Pick<PaymentLink, 'code' | 'title' | 'amountTRY' | 'status' | 'quotedUSDC' | 'receivedUSDC'>;
  settlement: Settlement | null;
};

/** GET /payments?page=&limit= → 200 */
export type GetPaymentsQuery = PageQuery;
export type GetPaymentsResponse = Paginated<PaymentWithLink>;

/** GET /settlements?page=&limit= → 200. One per paid link. */
export type GetSettlementsQuery = PageQuery;
export type GetSettlementsResponse = Paginated<Settlement>;

/**
 * POST /withdrawals → 201, status 'requested', amount reserved immediately.
 * 422 if > availableTRY · 400 if ≤ 0 or no IBAN in body or profile ·
 * 409 "Payouts are automatic in this mode" when settlementMode is 'auto_payout'.
 */
export interface PostWithdrawalsRequest {
  amountTRY: DecimalTRY;
  iban?: Iban;                     // defaults to the profile IBAN
}
export type PostWithdrawalsResponse = Withdrawal;

/** GET /withdrawals?page=&limit= → 200 */
export type GetWithdrawalsQuery = PageQuery;
export type GetWithdrawalsResponse = Paginated<Withdrawal>;

/**
 * POST /usdc-withdrawals → 201. Usually 'completed' (~5 s); 'submitted' if Horizon did not
 * confirm in time. 400 bad amount / address / source · 422 insufficient balance, or destination
 * missing, without a USDC trustline, without trustline room, or equal to the platform account.
 */
export interface PostUsdcWithdrawalsRequest {
  amountUSDC: DecimalUSDC;
  destination: StellarAccountId;
  source: 'saved' | 'unallocated';
}
export type PostUsdcWithdrawalsResponse = UsdcWithdrawal;

/** GET /usdc-withdrawals?page=&limit= → 200 */
export type GetUsdcWithdrawalsQuery = PageQuery;
export type GetUsdcWithdrawalsResponse = Paginated<UsdcWithdrawal>;

/** GET /unallocated?page=&limit= → 200 */
export type GetUnallocatedQuery = PageQuery;
export interface GetUnallocatedResponse extends Paginated<UnallocatedCredit> {
  summary: {
    creditedUSDC: DecimalUSDC;
    withdrawnUSDC: DecimalUSDC;
    remainingUSDC: DecimalUSDC;    // = Balance.unallocatedUSDC
  };
}

// ---------------------------------------------------------------------------------------------
// Payer (public, no auth). `:code` is case-insensitive.
// ---------------------------------------------------------------------------------------------

/**
 * GET /pay/:code → 200. Re-quotes when the quote expired, status is 'open', and the link is not
 * on-chain (on-chain quotes are locked). 404 unknown code.
 */
export type GetPayResponse = PayQuote;

/** POST /pay/:code/submitted → 202. A hint to check this tx immediately; detection works without it. */
export interface PostPaySubmittedRequest {
  txHash: TxHash;
}
export interface PostPaySubmittedResponse {
  accepted: true;
}

/** GET /pay/:code/status → 200. Poll every 2 s. */
export interface GetPayStatusResponse {
  status: LinkStatus;
  receivedUSDC: DecimalUSDC;
  shortfallUSDC?: DecimalUSDC;
  payment?: Payment;
  payments: Payment[];
}

/**
 * GET /pay/:code/agent — x402 v2, `exact` scheme, testnet only, experimental.
 * - No PAYMENT-SIGNATURE header → 402, body GetPayAgentPaymentRequired + base64 PAYMENT-REQUIRED header.
 * - Valid header → 200 GetPayAgentResponse + PAYMENT-RESPONSE header.
 * - Facilitator timed out while settling → 202 GetPayAgentPendingResponse; poll /pay/:code/status.
 * - 409 link not open/underpaid, or tx hash already processed · 503 x402 disabled or facilitator down.
 */
export type X402Header = 'PAYMENT-SIGNATURE' | 'PAYMENT-REQUIRED' | 'PAYMENT-RESPONSE';

/**
 * 402 body: the x402 v2 `PaymentRequired` object — scheme `exact`, network `stellar:testnet`,
 * asset = the USDC SAC, amount = amount due in 7-dp base units, payTo = platform account, no memo.
 */
export type GetPayAgentPaymentRequired = unknown; // OPEN: shape owned by the x402 v2 spec; not restated in 00-PROJECT.md

export interface GetPayAgentResponse {
  code: string;
  linkStatus: LinkStatus;
  rail: 'x402';
  network: 'stellar:testnet';      // x402 fields use the x402 spec's network id; PayQuote.network is LiraLink's own 'testnet'
  facilitator: string;             // OPEN: URL or name not documented
  credit: unknown;                 // OPEN: shape not documented
  reason?: string;                 // OPEN: meaning and values not documented
  settlement: Settlement | null;   // OPEN: nullability not documented (null for an installment, as in GET /payments?)
  payment: Payment;
}

export interface GetPayAgentPendingResponse {
  code: string;
  status: 'pending';
  x402SettlementId: string;
  rail: 'x402';
  network: 'stellar:testnet';      // x402 spec id, see GetPayAgentResponse.network
  facilitator: string;             // OPEN: same as GetPayAgentResponse.facilitator
}

// ---------------------------------------------------------------------------------------------
// System (public)
// ---------------------------------------------------------------------------------------------

/** GET /health → 200 */
export interface GetHealthResponse {
  ok: boolean;                     // OPEN: type not documented; boolean assumed from the name
  horizon: 'up' | 'down';
  anchor: AnchorProvider;
  listener: 'running' | 'stopped';
  platformAccount: StellarAccountId;
  settlementMode: SettlementMode;
}

/** GET /fx → 200 */
export interface GetFxResponse {
  pair: 'USDC/TRY';
  rate: FxRate;                    // OPEN: type not documented; decimal string assumed, matching fxRate
  source: FxSource;
  fetchedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------------------------
// Endpoint index — path params in `:name` form, relative to `/api`.
// ---------------------------------------------------------------------------------------------

export interface Endpoints {
  'POST /auth/register':       { auth: false; body: PostAuthRegisterRequest;    response: PostAuthRegisterResponse };
  'POST /auth/login':          { auth: false; body: PostAuthLoginRequest;       response: PostAuthLoginResponse };
  'GET /me':                   { auth: true;  body: never;                      response: GetMeResponse };
  'PATCH /me':                 { auth: true;  body: PatchMeRequest;             response: PatchMeResponse };
  'POST /links':               { auth: true;  body: PostLinksRequest;           response: PostLinksResponse };
  'GET /links':                { auth: true;  query: GetLinksQuery;             response: GetLinksResponse };
  'GET /links/:id':            { auth: true;  body: never;                      response: GetLinkResponse };
  'POST /links/:id/cancel':    { auth: true;  body: never;                      response: PostLinkCancelResponse };
  'POST /links/:id/onchain':   { auth: true;  body: never;                      response: PostLinkOnchainResponse };
  'GET /balance':              { auth: true;  body: never;                      response: GetBalanceResponse };
  'GET /payments':             { auth: true;  query: GetPaymentsQuery;          response: GetPaymentsResponse };
  'GET /settlements':          { auth: true;  query: GetSettlementsQuery;       response: GetSettlementsResponse };
  'POST /withdrawals':         { auth: true;  body: PostWithdrawalsRequest;     response: PostWithdrawalsResponse };
  'GET /withdrawals':          { auth: true;  query: GetWithdrawalsQuery;       response: GetWithdrawalsResponse };
  'POST /usdc-withdrawals':    { auth: true;  body: PostUsdcWithdrawalsRequest; response: PostUsdcWithdrawalsResponse };
  'GET /usdc-withdrawals':     { auth: true;  query: GetUsdcWithdrawalsQuery;   response: GetUsdcWithdrawalsResponse };
  'GET /unallocated':          { auth: true;  query: GetUnallocatedQuery;       response: GetUnallocatedResponse };
  'GET /pay/:code':            { auth: false; body: never;                      response: GetPayResponse };
  'POST /pay/:code/submitted': { auth: false; body: PostPaySubmittedRequest;    response: PostPaySubmittedResponse };
  'GET /pay/:code/status':     { auth: false; body: never;                      response: GetPayStatusResponse };
  'GET /pay/:code/agent':      { auth: false; body: never;                      response: GetPayAgentResponse | GetPayAgentPendingResponse; paymentRequired: GetPayAgentPaymentRequired };
  'GET /health':               { auth: false; body: never;                      response: GetHealthResponse };
  'GET /fx':                   { auth: false; body: never;                      response: GetFxResponse };
}
