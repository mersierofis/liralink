import type { AnchorBlockedReason, AnchorProvider, SettleFailReason, SettlementMode } from '../../contract/api.types';
import type { AnchorCompletion } from '../settlement-math';

/** A settlement as an adapter sees it: amounts as decimal strings, plus its resumable state. */
export interface SettlementView {
  id: string;
  merchantId: string;
  amountUSDC: string;
  amountTRY: string;
  status: 'pending' | 'processing';
  anchorRef: string | null;
  anchorMemo: string | null;
  anchorStatus: string | null;
  payTo: string | null;
  payMemo: string | null;
  payMemoType: string | null;
  paymentXdr: string | null;
  paymentTxHash: string | null;
}

export interface MerchantView {
  id: string;
  iban: string | null;
  sep12CustomerId: string | null;
  sep12Iban: string | null;
  sep12HomeDomain: string | null;
}

/** Persisted immediately by the service, so a crash right after never repeats the step. */
export interface Progress {
  status?: 'processing';
  anchorRef?: string;
  anchorMemo?: string;
  anchorStatus?: string;
  payTo?: string;
  payMemo?: string;
  payMemoType?: string;
  paymentXdr?: string;
  paymentTxHash?: string;
  interactiveUrl?: string | null;
  /** Set while the anchor waits for info; cleared (null) when it moves on. Internal only. */
  blockedReason?: AnchorBlockedReason | null;
}

export interface SettleContext {
  settlement: SettlementView;
  merchant: MerchantView;
  progress(p: Progress): Promise<void>;
  saveSep12(customer: { sep12CustomerId: string; sep12Iban: string; sep12HomeDomain: string }): Promise<void>;
}

export type SettleOutcome =
  | { kind: 'completed'; completion: AnchorCompletion }
  | { kind: 'failed'; failReason: SettleFailReason }
  /** Cannot start yet (stays `pending`); the job retries. Nothing was sent. */
  | { kind: 'blocked'; blockedReason: AnchorBlockedReason }
  /** Still in progress at the anchor (stays `processing`); the job resumes it. */
  | { kind: 'waiting' };

/**
 * One anchor. `settle` must be resumable: called again for the same settlement (after a crash, a
 * thrown error or `waiting`) it continues from the persisted state and never repeats a payment.
 * Throwing means "transient": the settlement is left exactly as it is for the next run.
 */
export interface AnchorAdapter {
  readonly name: AnchorProvider;
  readonly settlementMode: SettlementMode;
  settle(ctx: SettleContext): Promise<SettleOutcome>;
}

export const ANCHOR_ADAPTERS = Symbol('ANCHOR_ADAPTERS');
