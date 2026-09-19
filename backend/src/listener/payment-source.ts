import { Horizon } from '@stellar/stellar-sdk';

/** Where payment records come from. Horizon in production; a fake in tests. */
export interface PaymentSource {
  /** Paging token of the newest existing record, or null if the account has none. */
  latestPagingToken(): Promise<string | null>;
  /** Up to `limit` records after `cursor`, oldest first. */
  page(cursor: string, limit: number): Promise<unknown[]>;
  /** Streams records after `cursor`, oldest first. Returns a function that closes the stream. */
  stream(cursor: string, onRecord: (record: unknown) => void, onError: (error: unknown) => void): () => void;
}

export const PAYMENT_SOURCE = Symbol('PAYMENT_SOURCE');

/** http:// to localhost / 127.0.0.1 / ::1 — the only plain-http Horizon the API will talk to. */
export function isLoopbackHttp(url: string): boolean {
  const u = new URL(url);
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** Payments to and from the platform account, each with its transaction joined (memo, ledger). */
export class HorizonPaymentSource implements PaymentSource {
  private readonly server: Horizon.Server;

  constructor(
    horizonUrl: string,
    private readonly account: string,
  ) {
    // The SDK refuses http:// unless told otherwise. Config only lets http through for a loopback
    // host (local and test), so allowHttp follows the URL.
    this.server = new Horizon.Server(horizonUrl, { allowHttp: isLoopbackHttp(horizonUrl) });
  }

  private payments() {
    return this.server.payments().forAccount(this.account).join('transactions');
  }

  async latestPagingToken(): Promise<string | null> {
    const page = await this.payments().order('desc').limit(1).call();
    return page.records[0]?.paging_token ?? null;
  }

  async page(cursor: string, limit: number): Promise<unknown[]> {
    return (await this.payments().cursor(cursor).order('asc').limit(limit).call()).records;
  }

  stream(cursor: string, onRecord: (record: unknown) => void, onError: (error: unknown) => void): () => void {
    return this.payments().cursor(cursor).stream({ onmessage: onRecord, onerror: onError });
  }
}
