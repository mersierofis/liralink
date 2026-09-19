import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Horizon } from '@stellar/stellar-sdk';
import { AppConfig } from '../config/app-config';
import { PaymentsService } from '../payments/payments.service';
import { type HorizonPaymentRecord, toInboundOp } from './horizon-payment';

const RECONCILE_MS = 120_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

@Injectable()
export class HorizonListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(HorizonListenerService.name);
  private readonly server: Horizon.Server;
  private closeStream: (() => void) | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private backoffMs = BACKOFF_START_MS;
  private _running = false;
  private _cursor: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly payments: PaymentsService,
  ) {
    this.server = new Horizon.Server(config.env.HORIZON_URL, { allowHttp: false });
  }

  get running(): boolean {
    return this._running;
  }

  get cursor(): string | null {
    return this._cursor;
  }

  async onModuleInit(): Promise<void> {
    // E2E boots the full AppModule; do not open a live SSE stream in tests.
    if (this.config.env.NODE_ENV === 'test') {
      this.log.log('Horizon listener disabled in test (call processInbound in unit/e2e fixtures)');
      return;
    }
    this._cursor = await this.payments.getCursor();
    this.startStream();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((err) => this.log.warn(`reconcile: ${String(err)}`));
    }, RECONCILE_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this._running = false;
    this.closeStream?.();
    this.closeStream = null;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  private startStream(): void {
    if (this.stopped) return;
    const account = this.config.platformAccount;
    const cursor = this._cursor ?? 'now';
    this.log.log(`Horizon payments stream for ${account} from cursor=${cursor}`);

    try {
      this.closeStream?.();
      const builder = this.server
        .payments()
        .forAccount(account)
        .join('transactions')
        .cursor(cursor)
        .limit(50);

      this.closeStream = builder.stream({
        onmessage: (rec) => {
          void this.onRecord(rec as unknown as HorizonPaymentRecord);
        },
        onerror: (err: unknown) => {
          this._running = false;
          this.log.warn(`Horizon stream error: ${String(err)}; reconnecting in ${this.backoffMs}ms`);
          this.closeStream?.();
          this.closeStream = null;
          setTimeout(() => this.startStream(), this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
        },
      });
      this._running = true;
      this.backoffMs = BACKOFF_START_MS;
    } catch (err) {
      this._running = false;
      this.log.error(`failed to open Horizon stream: ${String(err)}`);
      setTimeout(() => this.startStream(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    }
  }

  private async onRecord(rec: HorizonPaymentRecord): Promise<void> {
    const op = toInboundOp(rec);
    if (!op) {
      // Still advance cursor past ops we ignore so we do not re-read them forever.
      if (rec.paging_token) {
        this._cursor = rec.paging_token;
        await this.payments.persistCursor(rec.paging_token).catch(() => undefined);
      }
      return;
    }
    try {
      const result = await this.payments.processInbound(op);
      this._cursor = op.pagingToken;
      if (result.outcome === 'applied') {
        this.log.log(
          `applied ${op.opId} tx=${op.txHash.slice(0, 8)}… → ${result.decision.kind}` +
            (result.decision.kind === 'credit'
              ? ` ${result.decision.status}`
              : ` ${result.decision.reason}`),
        );
      }
    } catch (err) {
      this.log.error(`processInbound ${op.opId} failed: ${String(err)}`);
    }
  }

  /** REST poll over the same cursor range — SSE can stall without erroring (01-BACKEND.md). */
  async reconcile(): Promise<void> {
    if (this.stopped || this.config.env.NODE_ENV === 'test') return;
    const cursor = this._cursor ?? (await this.payments.getCursor()) ?? 'now';
    if (cursor === 'now') return;

    const page = await this.server
      .payments()
      .forAccount(this.config.platformAccount)
      .join('transactions')
      .cursor(cursor)
      .order('asc')
      .limit(100)
      .call();

    for (const rec of page.records as unknown as HorizonPaymentRecord[]) {
      await this.onRecord(rec);
    }
  }
}
