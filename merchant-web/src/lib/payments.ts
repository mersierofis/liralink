import { formatUSDC } from './money'
import type { PaymentWithLink } from '@/api/types'

export interface UnsettledPaymentInfo {
  label: string
  detail: string
}

/**
 * Only meaningful when `payment.settlement` is null (an installment that didn't itself
 * complete its link — 04-BACKEND-HANDOFF.md gotcha #5). Uses the link's CURRENT status and
 * totals (`payment.link.status`/`quotedUSDC`/`receivedUSDC`, added in PR #5) as the source of
 * truth — never infer this by searching other rows on the same page for a "completing"
 * payment, which silently gives the wrong answer whenever that payment isn't in the current
 * page of results, or (as caught in review) when the link is still `underpaid` and nothing
 * has completed it yet.
 *
 * Defensive fallback: `link.status` is typed as required, but if a deploy is ever behind the
 * merged contract (seen once already — PR #5 landed in docs/api.types.ts before the live
 * testnet backend had redeployed it) these fields come back `undefined` at runtime. Render a
 * generic label instead of literally showing "undefined".
 */
export function describeUnsettledPayment(payment: PaymentWithLink): UnsettledPaymentInfo {
  const { link } = payment
  if (!link.status) {
    return {
      label: 'Partial payment',
      detail: 'This transfer did not complete its link on its own — settled together with another payment.',
    }
  }
  if (link.status === 'underpaid') {
    return {
      label: `Partial — ${formatUSDC(link.receivedUSDC)} of ${formatUSDC(link.quotedUSDC)}`,
      detail: 'This link is still underpaid — awaiting the rest of the payment.',
    }
  }
  if (link.status === 'paid') {
    return {
      label: 'Earlier installment',
      detail: "A different payment completed this link and carries its settlement — see the link's page for the full history.",
    }
  }
  // open (shouldn't have a partial payment without going underpaid, but handled defensively),
  // expired, or cancelled: the link never completed, so this payment was never settled and
  // never will be.
  return {
    label: `Partial — link ${link.status}`,
    detail: `This link ${link.status} before it was fully paid, so this payment was never settled.`,
  }
}

/** Payments whose settlement is waiting on the merchant to complete a real anchor's KYC/bank-
 * details form (04-BACKEND-HANDOFF.md §2 + §5) — used to drive the dashboard banner and to decide
 * whether to keep polling. `interactiveUrl` is only ever non-null while `status === 'processing'`. */
export function findAwaitingVerification(payments: PaymentWithLink[]): PaymentWithLink[] {
  return payments.filter((p) => p.settlement?.interactiveUrl)
}
