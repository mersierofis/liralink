import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { addUSDC, formatUSDC } from '../common/money';
import type { PayRail, Prisma } from '../generated/prisma/client';
import type { PaidEvent } from '../invoice/invoice-contract';
import { PrismaService } from '../prisma/prisma.service';
import type { InboundOp } from './inbound-op';
import { PaymentEvents } from './payment-events';
import { type Classified, type Decision, type LinkState, type MatcherConfig, classify, decide } from './matcher';

type Tx = Prisma.TransactionClient;

export interface ProcessResult {
  /** payment:paid | payment:underpaid | stray | attempt:<reason> | ignored:<why> | duplicate */
  outcome: string;
}

/**
 * Applies one Horizon operation. The operation's effects, its ProcessedOperation row and the
 * cursor move commit in ONE database transaction: a crash leaves either all of them or none, and
 * a replay of the same operation finds its ProcessedOperation row and changes nothing.
 */
@Injectable()
export class PaymentProcessor {
  readonly cfg: MatcherConfig;
  readonly streamName: string;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
    private readonly events: PaymentEvents,
  ) {
    this.cfg = { platformAccount: config.platformAccount, usdcCode: config.env.USDC_CODE, usdcIssuer: config.env.USDC_ISSUER };
    this.streamName = `horizon-payments:${config.platformAccount}`;
  }

  async loadCursor(): Promise<string | null> {
    const row = await this.prisma.listenerCursor.findUnique({ where: { stream: this.streamName } });
    return row?.pagingToken ?? null;
  }

  async saveCursor(pagingToken: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.advanceCursor(tx, pagingToken));
  }

  async process(op: InboundOp): Promise<ProcessResult> {
    const classified = classify(op, this.cfg); // throws on a malformed amount: never guess
    let completedLinkId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      if (await tx.processedOperation.findUnique({ where: { opId: op.opId } })) {
        await this.advanceCursor(tx, op.pagingToken);
        return { outcome: 'duplicate' };
      }

      const code = classified.kind === 'usdc' || classified.kind === 'wrong_asset' ? classified.code : null;
      const link = code ? await this.lockLink(tx, code) : null;
      const decision = decide(classified, link, op.createdAt, this.cfg);
      const outcome = await this.apply(tx, decision, op, 'memo');
      if (decision.kind === 'credit' && decision.credit.status === 'paid') completedLinkId = decision.link.id;

      // The primary key is the idempotency guard; a concurrent duplicate fails the whole transaction.
      await tx.processedOperation.create({ data: { opId: op.opId, txHash: op.txHash, outcome } });
      await this.advanceCursor(tx, op.pagingToken);
      return { outcome };
    });
    // Only after commit, so settlement never sees a payment that could still roll back.
    if (completedLinkId) this.events.emitPaymentDetected({ linkId: completedLinkId, txHash: op.txHash });
    return result;
  }

  /**
   * Applies one `paid` event of the invoice contract, through the same matcher and the same effects
   * as a memo payment (credit, stray, payment.detected → settlement), with `rail: 'contract'`.
   *
   * Credited exactly once: the event's ProcessedOperation row (`soroban:<event id>`) makes a replay
   * a no-op, and a transaction that already has a Payment is never credited again, whichever path
   * recorded it. The Horizon listener never credits this transfer: Horizon reports it as an
   * `invoke_host_function` operation, which the matcher ignores.
   */
  async processContractPaid(paid: PaidEvent): Promise<ProcessResult> {
    const opId = `soroban:${paid.eventId}`;
    let completedLinkId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      if (await tx.processedOperation.findUnique({ where: { opId } })) return { outcome: 'duplicate' };
      if (await tx.payment.findUnique({ where: { txHash: paid.txHash } })) {
        await tx.processedOperation.create({ data: { opId, txHash: paid.txHash, outcome: 'duplicate:tx_already_credited' } });
        return { outcome: 'duplicate' };
      }

      // Every invoice this API creates pays out to the platform account; anything else is not our money.
      const classified: Classified =
        paid.merchant === this.cfg.platformAccount
          ? { kind: 'usdc', code: paid.code, amount: paid.amountUSDC }
          : { kind: 'ignore', why: 'contract payout is not the platform account' };
      const link = classified.kind === 'usdc' ? await this.lockLink(tx, paid.code) : null;
      const decision = decide(classified, link, paid.paidAt, this.cfg);
      const op = { opId, txHash: paid.txHash, ledger: paid.ledger, from: paid.payer };
      const outcome = await this.apply(tx, decision, op, 'contract');
      if (decision.kind === 'credit' && decision.credit.status === 'paid') completedLinkId = decision.link.id;

      await tx.processedOperation.create({ data: { opId, txHash: paid.txHash, outcome } });
      return { outcome };
    });
    if (completedLinkId) this.events.emitPaymentDetected({ linkId: completedLinkId, txHash: paid.txHash });
    return result;
  }

  /** Row-locks the link, so a concurrent cancel or a second operation waits for this one. */
  private async lockLink(tx: Tx, code: string): Promise<LinkState | null> {
    await tx.$queryRaw`SELECT 1 FROM "PaymentLink" WHERE "code" = ${code} FOR UPDATE`;
    const row = await tx.paymentLink.findUnique({ where: { code } });
    return row
      ? {
          id: row.id,
          code: row.code,
          merchantId: row.merchantId,
          status: row.status,
          quotedUSDC: formatUSDC(row.quotedUSDC),
          receivedUSDC: formatUSDC(row.receivedUSDC),
          expiresAt: row.expiresAt,
        }
      : null;
  }

  private async apply(tx: Tx, d: Decision, op: Pick<InboundOp, 'txHash' | 'ledger' | 'from' | 'opId'>, rail: PayRail): Promise<string> {
    switch (d.kind) {
      case 'ignore':
        return `ignored:${d.why}`;

      case 'attempt':
        await tx.paymentAttempt.create({
          data: {
            linkCode: d.linkCode,
            merchantId: d.merchantId,
            txHash: op.txHash,
            amount: d.amount,
            assetCode: d.assetCode,
            assetIssuer: d.assetIssuer,
            reason: d.reason,
          },
        });
        return `attempt:${d.reason}`;

      case 'stray': {
        const { link, amount } = d;
        const status = d.expireLink ? 'expired' : link.status;
        if (d.expireLink) await tx.paymentLink.update({ where: { id: link.id }, data: { status: 'expired' } });
        await tx.paymentAttempt.create({
          data: {
            linkCode: link.code,
            merchantId: link.merchantId,
            txHash: op.txHash,
            amount,
            assetCode: this.cfg.usdcCode,
            assetIssuer: this.cfg.usdcIssuer,
            reason: 'link_not_open',
          },
        });
        await tx.unallocatedCredit.create({
          data: {
            merchantId: link.merchantId,
            source: 'stray',
            txHash: op.txHash,
            amountUSDC: amount,
            linkCode: link.code,
            reason: `Payment to link ${link.code} after it was ${status}; credited in full`,
          },
        });
        await tx.merchant.update({ where: { id: link.merchantId }, data: { unallocatedUSDC: { increment: amount } } });
        return 'stray';
      }

      case 'credit': {
        const { link, amount, credit } = d;
        if (op.ledger === null) throw new Error(`op ${op.opId}: no ledger on the joined transaction`);
        // One Payment per transaction: a second operation of the same transaction (same memo, so
        // the same link) adds to it instead of creating a second row.
        const existing = await tx.payment.findUnique({ where: { txHash: op.txHash } });
        if (existing) {
          await tx.payment.update({ where: { id: existing.id }, data: { amountUSDC: addUSDC(existing.amountUSDC, amount) } });
        } else {
          await tx.payment.create({
            data: { linkId: link.id, rail, txHash: op.txHash, payerAddress: op.from ?? '', amountUSDC: amount, ledger: op.ledger },
          });
        }
        await tx.paymentLink.update({
          where: { id: link.id },
          data: { receivedUSDC: credit.receivedUSDC, status: credit.status, shortfallUSDC: credit.shortfallUSDC },
        });
        if (credit.excessUSDC !== null) {
          await tx.unallocatedCredit.create({
            data: {
              merchantId: link.merchantId,
              source: 'overpaid',
              txHash: op.txHash,
              amountUSDC: credit.excessUSDC,
              linkCode: link.code,
              reason: `Overpaid link ${link.code} by ${credit.excessUSDC} USDC`,
            },
          });
          await tx.merchant.update({ where: { id: link.merchantId }, data: { unallocatedUSDC: { increment: credit.excessUSDC } } });
        }
        return `payment:${credit.status}`;
      }
    }
  }

  /** Moves the cursor forward only: paging tokens are ever-increasing 64-bit integers. */
  private async advanceCursor(tx: Tx, pagingToken: string): Promise<void> {
    const current = await tx.listenerCursor.findUnique({ where: { stream: this.streamName } });
    if (current && BigInt(current.pagingToken) >= BigInt(pagingToken)) return;
    await tx.listenerCursor.upsert({
      where: { stream: this.streamName },
      create: { stream: this.streamName, pagingToken },
      update: { pagingToken },
    });
  }
}
