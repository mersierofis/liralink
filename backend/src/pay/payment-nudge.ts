import { Injectable } from '@nestjs/common';
import { InvoiceWatcher } from '../invoice/invoice-watcher.service';
import { ListenerService } from '../listener/listener.service';

/** At most one nudge per interval, however often POST /pay/:code/submitted is called. */
const NUDGE_MIN_INTERVAL_MS = 1_000;

/**
 * POST /pay/:code/submitted is a hint, not a trigger anyone depends on: it makes the contract
 * watcher and the Horizon catch-up run now instead of on their next tick. Both are idempotent and
 * never throw, and detection works without the hint. Throttled, so the public endpoint cannot be
 * used to hammer Soroban RPC or Horizon.
 */
@Injectable()
export class PaymentNudge {
  private last = 0;

  constructor(
    private readonly listener: ListenerService,
    private readonly watcher: InvoiceWatcher,
  ) {}

  nudge(): void {
    const now = Date.now();
    if (now - this.last < NUDGE_MIN_INTERVAL_MS) return;
    this.last = now;
    void this.watcher.poll();
    void this.listener.catchUp();
  }
}
