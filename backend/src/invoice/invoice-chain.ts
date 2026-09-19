import { Address, BASE_FEE, Contract, Keypair, nativeToScVal, rpc, scValToNative, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';
import { INVOICE_ERROR, type PaidEvent, contractErrorCode, deadlineLedgerFor, parsePaidEvent } from './invoice-contract';

/** Where the watcher resumes: the saved RPC cursor, or (first start / lost cursor) a ledger. */
export type EventsFrom = { cursor: string } | { fromOldestRetained: true };

/** The invoice contract as the API uses it. Soroban RPC in production; a fake in tests. */
export interface InvoiceChain {
  readonly contractId: string;
  /**
   * Records `code` as a Pending invoice payable to the platform account until the ledger matching
   * `expiresAt`, signed as admin. An invoice that already exists (a retry after a lost response)
   * is read back instead of failing, with `txHash: null`.
   */
  create(p: { code: string; amountStroops: bigint; expiresAt: Date }): Promise<{ txHash: string | null; deadlineLedger: number }>;
  /** Pending → Cancelled, signed as admin. Resolves with the tx hash. */
  cancel(code: string): Promise<string>;
  /**
   * One page of `paid` events after the cursor, oldest first, and the cursor to resume from.
   * `more` is true when the page was full and another read may return more.
   */
  paidEvents(from: EventsFrom): Promise<{ events: PaidEvent[]; cursor: string; more: boolean }>;
}

export const INVOICE_CHAIN = Symbol('INVOICE_CHAIN');

export class InvoiceContractError extends Error {
  constructor(
    readonly contractCode: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** Every RPC request gives up after this long, so a hung RPC can never hold a caller forever. */
const RPC_TIMEOUT_MS = 10_000;
/** How many times to poll for a submitted transaction (1 s apart) before giving up on it. */
const POLL_ATTEMPTS = 30;
const EVENTS_PAGE_LIMIT = 100;

export class SorobanInvoiceChain implements InvoiceChain {
  private readonly server: rpc.Server;

  constructor(
    readonly contractId: string,
    rpcUrl: string,
    private readonly admin: Keypair,
    private readonly networkPassphrase: string,
  ) {
    this.server = new rpc.Server(rpcUrl, { timeout: RPC_TIMEOUT_MS, allowHttp: rpcUrl.startsWith('http://') });
  }

  async create(p: { code: string; amountStroops: bigint; expiresAt: Date }): Promise<{ txHash: string | null; deadlineLedger: number }> {
    const { sequence } = await this.server.getLatestLedger();
    const deadlineLedger = deadlineLedgerFor(p.expiresAt, new Date(), sequence);
    try {
      const txHash = await this.invoke('create', [
        // Custodial: every invoice pays out to the platform account, which is also the admin.
        new Address(this.admin.publicKey()).toScVal(),
        nativeToScVal(p.code, { type: 'symbol' }),
        nativeToScVal(p.amountStroops, { type: 'i128' }),
        nativeToScVal(deadlineLedger, { type: 'u32' }),
      ]);
      return { txHash, deadlineLedger };
    } catch (err) {
      if (!(err instanceof InvoiceContractError) || err.contractCode !== INVOICE_ERROR.AlreadyExists) throw err;
      const existing = await this.get(p.code);
      if (existing.amount !== p.amountStroops) {
        throw new InvoiceContractError(INVOICE_ERROR.AlreadyExists, `invoice ${p.code} exists on-chain with amount ${existing.amount}, expected ${p.amountStroops}`);
      }
      return { txHash: null, deadlineLedger: existing.deadline };
    }
  }

  cancel(code: string): Promise<string> {
    return this.invoke('cancel', [nativeToScVal(code, { type: 'symbol' })]);
  }

  async paidEvents(from: EventsFrom): Promise<{ events: PaidEvent[]; cursor: string; more: boolean }> {
    const filters: rpc.Api.EventFilter[] = [
      { type: 'contract', contractIds: [this.contractId], topics: [[nativeToScVal('paid', { type: 'symbol' }).toXDR('base64'), '*']] },
    ];
    let page: rpc.Api.GetEventsResponse;
    if ('cursor' in from) {
      try {
        page = await this.server.getEvents({ filters, cursor: from.cursor, limit: EVENTS_PAGE_LIMIT });
      } catch (err) {
        // The cursor fell out of RPC retention (API down too long): replay what RPC still has.
        // Crediting is idempotent per event, so a replay changes nothing already credited.
        if (!isCursorRejected(err)) throw err;
        page = await this.fromOldest(filters);
      }
    } else {
      page = await this.fromOldest(filters);
    }
    const events = page.events.map((e) => parsePaidEvent(e)).filter((e): e is PaidEvent => e !== null);
    return { events, cursor: page.cursor, more: page.events.length >= EVENTS_PAGE_LIMIT };
  }

  private async fromOldest(filters: rpc.Api.EventFilter[]): Promise<rpc.Api.GetEventsResponse> {
    const { oldestLedger } = await this.server.getHealth();
    return this.server.getEvents({ filters, startLedger: oldestLedger, limit: EVENTS_PAGE_LIMIT });
  }

  private async get(code: string): Promise<{ amount: bigint; deadline: number; status: unknown }> {
    const { sim } = await this.simulate('get', [nativeToScVal(code, { type: 'symbol' })]);
    return scValToNative(sim.result!.retval) as { amount: bigint; deadline: number; status: unknown };
  }

  private async simulate(method: string, args: xdr.ScVal[]) {
    const account = await this.server.getAccount(this.admin.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(new Contract(this.contractId).call(method, ...args))
      .setTimeout(60)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new InvoiceContractError(contractErrorCode(sim.error), `invoice.${method} simulation failed: ${sim.error}`);
    }
    return { tx, sim };
  }

  /** Simulates, signs as admin, submits and waits for the result; resolves with the tx hash. */
  private async invoke(method: string, args: xdr.ScVal[]): Promise<string> {
    const { tx, sim } = await this.simulate(method, args);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(this.admin);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
      throw new InvoiceContractError(null, `invoice.${method} submit returned ${sent.status} (tx ${sent.hash})`);
    }
    const result = await this.server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new InvoiceContractError(null, `invoice.${method} tx ${sent.hash} ended ${result.status}`);
    }
    return sent.hash;
  }
}

function isCursorRejected(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cursor|startLedger|ledger range|out of range/i.test(message);
}
