import { Asset, BASE_FEE, Horizon, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

/** What the double-spend guard needs from the network. */
export interface StellarPayer {
  /** Builds and signs the USDC payment; nothing is sent. Time-bounded to 300 s. */
  build(p: { to: string; amountUSDC: string; memo: string; memoType: string }): Promise<{ xdr: string; hash: string }>;
  submit(xdr: string): Promise<void>;
  /** 'success' / 'failed' if the transaction is on the ledger, 'missing' if not. */
  lookup(hash: string): Promise<'success' | 'failed' | 'missing'>;
  /** True once a ledger has closed after the transaction's maxTime: it can never land. */
  provablyExpired(xdr: string): Promise<boolean>;
}

const TIMEOUT_S = 300;

/** Memo exactly as the anchor asked; an unknown type throws rather than sending memo-less money. */
function memoFor(type: string, value: string): Memo {
  switch (type) {
    case 'id':
      return Memo.id(value);
    case 'text':
      return Memo.text(value);
    case 'hash':
      return Memo.hash(Buffer.from(value, 'base64').toString('hex'));
    default:
      throw new Error(`anchor asked for memo type ${JSON.stringify(type)}; refusing to send a payment without the right memo`);
  }
}

export class HorizonStellarPayer implements StellarPayer {
  private readonly server: Horizon.Server;

  constructor(
    horizonUrl: string,
    private readonly keypair: Keypair,
    private readonly usdc: Asset,
    private readonly networkPassphrase: string,
    allowHttp: boolean,
  ) {
    this.server = new Horizon.Server(horizonUrl, { allowHttp });
  }

  async build(p: { to: string; amountUSDC: string; memo: string; memoType: string }): Promise<{ xdr: string; hash: string }> {
    const account = await this.server.loadAccount(this.keypair.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(Operation.payment({ destination: p.to, asset: this.usdc, amount: p.amountUSDC }))
      .addMemo(memoFor(p.memoType, p.memo))
      .setTimeout(TIMEOUT_S)
      .build();
    tx.sign(this.keypair);
    return { xdr: tx.toXDR(), hash: tx.hash().toString('hex') };
  }

  async submit(xdr: string): Promise<void> {
    await this.server.submitTransaction(TransactionBuilder.fromXDR(xdr, this.networkPassphrase));
  }

  async lookup(hash: string): Promise<'success' | 'failed' | 'missing'> {
    try {
      const tx = await this.server.transactions().transaction(hash).call();
      return tx.successful ? 'success' : 'failed';
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 404) return 'missing';
      throw err;
    }
  }

  async provablyExpired(xdr: string): Promise<boolean> {
    const tx = TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
    const maxTime = 'timeBounds' in tx && tx.timeBounds ? BigInt(tx.timeBounds.maxTime) : null;
    if (maxTime === null || maxTime === 0n) return false; // no upper bound: it could always still land
    const [latest] = (await this.server.ledgers().order('desc').limit(1).call()).records;
    return BigInt(Math.floor(new Date(latest.closed_at).getTime() / 1000)) > maxTime;
  }
}
