import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Emitted once, after commit, when a payment makes a link `paid`. The settlement step listens. */
export const PAYMENT_DETECTED = 'payment.detected';

export interface PaymentDetected {
  linkId: string;
  /** The transaction that completed the link. */
  txHash: string;
}

/**
 * Process-local bus between the listener and settlement (01-BACKEND.md: the listener never waits
 * on an anchor). Ported from PR #12. Delivery is at most once per process: a subscriber that
 * throws is logged and does not undo or stall the payment. The settlement reconciler must
 * therefore also pick up `paid` links that have no settlement yet.
 */
@Injectable()
export class PaymentEvents extends EventEmitter {
  private readonly logger = new Logger(PaymentEvents.name);

  emitPaymentDetected(event: PaymentDetected): void {
    try {
      this.emit(PAYMENT_DETECTED, event);
    } catch (error) {
      this.logger.error(`${PAYMENT_DETECTED} subscriber failed for link ${event.linkId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onPaymentDetected(handler: (event: PaymentDetected) => void): this {
    return this.on(PAYMENT_DETECTED, handler);
  }
}
