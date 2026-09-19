// Test double of tr-mock-anchor, reproducing what it was OBSERVED to do (anchor.md, and the probes
// of 2026-09-19): real SEP-10 challenges signed by the server key, SEP-12 over multipart with a
// Turkish-IBAN check, `GET /sep6/withdraw` only (POST → 404), a 1 USDC minimum answered as
// `400 {"error":"Minimum off-ramp is 1.0000000 USDC"}` whatever /info says, fee booked in TRY.
import { Keypair, Networks, WebAuth } from '@stellar/stellar-sdk';
import { compareDecimal } from '../../common/money';
import type { AnchorToml } from './anchor-session';
import type { StellarPayer } from './stellar-payer';

export const FAKE_DOMAIN = 'anchor.test';
const BASE = `https://${FAKE_DOMAIN}`;
export const FAKE_TREASURY = 'GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6';

export interface FakeTx {
  id: string;
  status: string;
  amount_in: string;
  memo: string;
  /** memo of the identity that opened it: transactions are scoped per JWT sub */
  owner: string;
  paid: boolean;
  /** statuses to walk through on each poll after the USDC arrived */
  script: string[];
  amount_out?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeAnchor {
  readonly server = Keypair.random();
  customers = new Map<string, { id: string; iban: string; status: string }>();
  txs = new Map<string, FakeTx>();
  calls: { method: string; path: string; query: Record<string, string>; form?: Record<string, string> }[] = [];
  /** Statuses after the USDC arrives, e.g. ['pending_anchor', 'completed']. */
  afterPayment: string[] = ['pending_anchor', 'completed'];
  minUSDC = '1';
  /** TRY per USDC the fake pays out at, and its TRY fee. */
  rate = '48.54';
  feeTRY = '0.25';
  dropMemoInSub = false;
  failNext: { path: string; status: number; body: unknown } | null = null;
  private n = 0;

  toml = async (): Promise<AnchorToml> => ({
    NETWORK_PASSPHRASE: Networks.TESTNET,
    SIGNING_KEY: this.server.publicKey(),
    WEB_AUTH_ENDPOINT: `${BASE}/auth`,
    TRANSFER_SERVER: `${BASE}/sep6`,
    KYC_SERVER: `${BASE}/sep12`,
  });

  /** A fetch that serves the anchor. */
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const query = Object.fromEntries(url.searchParams);
    let form: Record<string, string> | undefined;
    if (init?.body instanceof FormData) form = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, String(v)]));
    this.calls.push({ method, path: url.pathname, query, form });
    if (this.failNext && url.pathname === this.failNext.path) {
      const f = this.failNext;
      this.failNext = null;
      return json(f.status, f.body);
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    const sub = auth ? (JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString()).sub as string) : null;
    const memo = sub?.split(':')[1] ?? null;

    if (url.pathname === '/auth' && method === 'GET') {
      const tx = WebAuth.buildChallengeTx(this.server, query.account, FAKE_DOMAIN, 300, Networks.TESTNET, FAKE_DOMAIN, query.memo);
      return json(200, { transaction: tx, network_passphrase: Networks.TESTNET });
    }
    if (url.pathname === '/auth' && method === 'POST') {
      const { transaction } = JSON.parse(String(init?.body)) as { transaction: string };
      const read = WebAuth.readChallengeTx(transaction, this.server.publicKey(), Networks.TESTNET, FAKE_DOMAIN, FAKE_DOMAIN);
      const s = this.dropMemoInSub ? read.clientAccountID : `${read.clientAccountID}:${read.memo}`;
      const payload = Buffer.from(JSON.stringify({ sub: s, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      return json(200, { token: `e30.${payload}.sig` });
    }
    if (!memo) return json(401, { error: 'unauthorized' });

    if (url.pathname === '/sep12/customer' && method === 'GET') {
      const c = this.customers.get(memo);
      return json(200, c ? { id: c.id, status: c.status } : { status: 'NEEDS_INFO' });
    }
    if (url.pathname === '/sep12/customer' && method === 'PUT') {
      const iban = form?.bank_account_number ?? '';
      if (!/^TR\d{24}$/.test(iban)) return json(400, { error: 'bank_account_number must be a valid Turkish IBAN (TR + 24 digits)' });
      const id = this.customers.get(memo)?.id ?? `cus_${++this.n}`;
      this.customers.set(memo, { id, iban, status: 'ACCEPTED' });
      return json(202, { id });
    }
    if (url.pathname === '/sep6/withdraw') {
      if (method !== 'GET') return json(404, { error: { code: 'not_found', message: `No route for ${method} /sep6/withdraw` } });
      if (compareDecimal(query.amount, this.minUSDC) < 0) return json(400, { error: 'Minimum off-ramp is 1.0000000 USDC' });
      const id = `sep_${++this.n}`;
      const payMemo = (119098103830n + BigInt(this.n)).toString();
      this.txs.set(id, { id, status: 'pending_user_transfer_start', amount_in: query.amount, memo: payMemo, owner: memo, paid: false, script: [...this.afterPayment] });
      return json(200, { id, account_id: FAKE_TREASURY, memo: payMemo, memo_type: 'id', eta: 10 });
    }
    if (url.pathname === '/sep6/transaction') {
      const tx = this.txs.get(query.id);
      if (!tx || tx.owner !== memo) return json(404, { error: 'not found' }); // scoped per customer
      if (tx.paid && tx.script.length) tx.status = tx.script.shift()!;
      const body: Record<string, unknown> = { id: tx.id, kind: 'withdrawal', status: tx.status, amount_in: tx.amount_in, amount_in_asset: 'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
      if (tx.status === 'completed') {
        Object.assign(body, {
          amount_out: tx.amount_out ?? '50.00',
          amount_out_asset: 'iso4217:TRY',
          amount_fee: this.feeTRY,
          fee_details: { total: this.feeTRY, asset: 'iso4217:TRY' },
          to: this.customers.get(memo)?.iban,
        });
      }
      return json(200, { transaction: body });
    }
    return json(404, { error: `no route ${method} ${url.pathname}` });
  };

  /** What the platform account's payment did: marks the anchor transaction paid. */
  receive(memo: string): void {
    for (const tx of this.txs.values()) if (tx.memo === memo) tx.paid = true;
  }
}

/** Records every payment; `submit` delivers it to the fake anchor unless told to fail. */
export class FakePayer implements StellarPayer {
  built: { to: string; amountUSDC: string; memo: string; memoType: string; hash: string }[] = [];
  submitted: string[] = [];
  ledger = new Map<string, 'success' | 'failed'>();
  failSubmit: Error | null = null;
  expired = false;
  private n = 0;

  constructor(private readonly anchor: FakeAnchor) {}

  async build(p: { to: string; amountUSDC: string; memo: string; memoType: string }) {
    const hash = `hash${++this.n}`.padEnd(64, '0');
    this.built.push({ ...p, hash });
    return { xdr: `xdr:${hash}:${p.memo}`, hash };
  }
  async submit(xdr: string) {
    this.submitted.push(xdr);
    if (this.failSubmit) {
      const e = this.failSubmit;
      this.failSubmit = null;
      throw e;
    }
    const [, hash, memo] = xdr.split(':');
    this.ledger.set(hash, 'success');
    this.anchor.receive(memo);
  }
  async lookup(hash: string) {
    return this.ledger.get(hash) ?? 'missing';
  }
  async provablyExpired() {
    return this.expired;
  }
}
