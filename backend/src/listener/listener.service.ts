import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { toInboundOp } from './inbound-op';
import { PaymentProcessor } from './payment-processor';
import { PAYMENT_SOURCE, type PaymentSource } from './payment-source';

const PAGE_SIZE = 200;
/** REST catch-up poll: SSE can stall without erroring, so the same range is re-read by REST. */
const POLL_MS = 120_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface ListenerStatus {
  state: 'running' | 'stopped';
  cursor: string | null;
}

/**
 * The payment listener. Every record — from the SSE stream or the REST catch-up — goes through one
 * serialized queue, strictly in paging-token order, into PaymentProcessor. On ANY failure it stops,
 * closes the stream and reconnects with exponential backoff from the last committed cursor, so an
 * operation is never skipped: the cursor only moves past an operation once its effects committed.
 */
@Injectable()
export class ListenerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ListenerService.name);
  private state: 'running' | 'stopped' = 'stopped';
  /** Last committed paging token. */
  private cursor: string | null = null;
  /** Bumped on every (re)connect; queued work from an older connection is dropped. */
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private connecting: Promise<void> = Promise.resolve();
  private closeStream: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoffMs = BACKOFF_START_MS;
  private shuttingDown = false;

  constructor(
    private readonly processor: PaymentProcessor,
    @Inject(PAYMENT_SOURCE) private readonly source: PaymentSource,
  ) {}

  status(): ListenerStatus {
    return { state: this.state, cursor: this.cursor };
  }

  onApplicationBootstrap(): void {
    this.connecting = this.connect();
    this.pollTimer = setInterval(() => void this.catchUp(), POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.generation++;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.closeStream?.();
    this.state = 'stopped';
    await this.queue.catch(() => undefined);
  }

  /** Resolves once the current connection attempt and everything queued so far are done. */
  async idle(): Promise<void> {
    await this.connecting;
    await this.queue;
  }

  /** (Re)connects: resume from the saved cursor, drain by REST, then stream from there. */
  async connect(): Promise<void> {
    if (this.shuttingDown) return;
    const gen = ++this.generation;
    try {
      let cursor = await this.processor.loadCursor();
      if (cursor === null) {
        // First start ever: begin at the newest existing record, and persist that, so a restart
        // before the first payment still resumes here instead of at a later "now".
        cursor = (await this.source.latestPagingToken()) ?? '0';
        await this.processor.saveCursor(cursor);
      }
      this.cursor = cursor;
      await this.catchUp(gen);
      if (gen !== this.generation) return;
      this.closeStream = this.source.stream(
        this.cursor,
        (record) => this.enqueue(gen, () => this.handle(gen, record)),
        (error) => this.fail(gen, 'stream error', error),
      );
      this.state = 'running';
      this.backoffMs = BACKOFF_START_MS;
      this.logger.log(`streaming payments from cursor ${this.cursor}`);
    } catch (error) {
      this.fail(gen, 'connect failed', error);
    }
  }

  /** Reads every record after the cursor by REST, through the same queue as the stream. */
  catchUp(gen = this.generation): Promise<void> {
    return this.enqueue(gen, async () => {
      for (;;) {
        const records = await this.source.page(this.cursor ?? '0', PAGE_SIZE);
        for (const record of records) {
          if (gen !== this.generation) return;
          await this.handle(gen, record);
        }
        if (records.length < PAGE_SIZE) return;
      }
    });
  }

  private enqueue(gen: number, task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (gen !== this.generation) return;
      try {
        await task();
      } catch (error) {
        this.fail(gen, 'processing failed', error);
      }
    });
    return this.queue;
  }

  private async handle(gen: number, record: unknown): Promise<void> {
    if (gen !== this.generation) return;
    const op = toInboundOp(record);
    // Already behind the cursor (stream and catch-up overlap): committed before, nothing to do.
    if (this.cursor !== null && BigInt(op.pagingToken) <= BigInt(this.cursor)) return;
    const { outcome } = await this.processor.process(op);
    this.cursor = op.pagingToken;
    this.logger.log(`op ${op.opId} tx ${op.txHash} → ${outcome}`);
  }

  private fail(gen: number, what: string, error: unknown): void {
    if (gen !== this.generation || this.shuttingDown) return;
    this.generation++; // drop everything still queued for this connection
    this.state = 'stopped';
    this.closeStream?.();
    this.closeStream = null;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.logger.error(`${what}: ${error instanceof Error ? error.message : String(error)} — reconnecting in ${wait} ms from cursor ${this.cursor}`);
    this.retryTimer = setTimeout(() => (this.connecting = this.connect()), wait);
  }
}
