import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { addUSDC, formatUSDC } from '../common/money';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PaymentEvents } from './payment-events';
import {
  type InboundOp,
  type LinkForMatch,
  type MatcherConfig,
  linkCodeFromMemoBytes,
  matchInbound,
} from './payment-matcher';

export const HORIZON_CURSOR_ID = 'horizon-payments';
export const PAYMENT_DETECTED = 'payment.detected';

export type ProcessResult =
  | { outcome: 'applied'; decision: ReturnType<typeof matchInbound> }
  | { outcome: 'duplicate' };

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly events: PaymentEvents,
  ) {}

  matcherConfig(now = new Date()): MatcherConfig {
    return {
      platformAccount: this.config.platformAccount,
      usdcCode: this.config.env.USDC_CODE,
      usdcIssuer: this.config.env.USDC_ISSUER,
      now,
    };
  }

  /**
   * Apply one Horizon operation idempotently: ProcessedOperation + credit/attempt + cursor
   * in a single transaction. Unique-constraint on opId means "already seen".
   */
  async processInbound(op: InboundOp, now = new Date()): Promise<ProcessResult> {
    try {
      const decision = await this.prisma.$transaction(async (tx) => {
        await tx.processedOperation.create({
          data: { opId: op.opId, txHash: op.txHash },
        });

        const code = linkCodeFromMemoBytes(op.memoType, op.memoBytes);
        const row = code ? await tx.paymentLink.findUnique({ where: { code } }) : null;

        const link: LinkForMatch | null = row
          ? {
              id: row.id,
              code: row.code,
              merchantId: row.merchantId,
              status: row.status,
              expiresAt: row.expiresAt,
              quotedUSDC: formatUSDC(row.quotedUSDC),
              receivedUSDC: formatUSDC(row.receivedUSDC),
            }
          : null;

        const decided = matchInbound(op, link, this.matcherConfig(now));

        if (decided.kind === 'credit') {
          await tx.payment.create({
            data: {
              linkId: decided.link.id,
              rail: 'memo',
              txHash: op.txHash,
              payerAddress: op.from,
              amountUSDC: decided.amountUSDC,
              ledger: op.ledger,
            },
          });
          await tx.paymentLink.update({
            where: { id: decided.link.id },
            data: {
              receivedUSDC: decided.totalReceivedUSDC,
              status: decided.status,
              shortfallUSDC: decided.shortfallUSDC,
            },
          });
          if (decided.excessUSDC) {
            await tx.merchant.update({
              where: { id: decided.link.merchantId },
              data: { unallocatedUSDC: { increment: decided.excessUSDC } },
            });
            await tx.unallocatedCredit.create({
              data: {
                merchantId: decided.link.merchantId,
                source: 'overpaid',
                txHash: op.txHash,
                amountUSDC: decided.excessUSDC,
                linkCode: decided.link.code,
                reason: 'overpaid',
              },
            });
          }
        } else {
          await tx.paymentAttempt.create({
            data: {
              linkCode: decided.linkCode,
              merchantId: decided.merchantId,
              txHash: op.txHash,
              amount: decided.amount,
              assetCode: decided.assetCode,
              assetIssuer: decided.assetIssuer,
              reason: decided.reason,
            },
          });
          if (decided.strayUSDC && decided.merchantId && decided.linkCode) {
            await tx.merchant.update({
              where: { id: decided.merchantId },
              data: { unallocatedUSDC: { increment: decided.strayUSDC } },
            });
            await tx.unallocatedCredit.create({
              data: {
                merchantId: decided.merchantId,
                source: 'stray',
                txHash: op.txHash,
                amountUSDC: decided.strayUSDC,
                linkCode: decided.linkCode,
                reason: 'link_not_open',
              },
            });
          }
        }

        await tx.listenerCursor.upsert({
          where: { id: HORIZON_CURSOR_ID },
          create: { id: HORIZON_CURSOR_ID, cursor: op.pagingToken },
          update: { cursor: op.pagingToken },
        });

        return decided;
      });

      if (decision.kind === 'credit' && decision.status === 'paid') {
        this.events.emit(PAYMENT_DETECTED, {
          linkId: decision.link.id,
          txHash: op.txHash,
        });
      }

      return { outcome: 'applied', decision };
    } catch (err) {
      if (isUniqueViolation(err)) {
        await this.persistCursor(op.pagingToken).catch((e) =>
          this.log.warn(`cursor update after duplicate failed: ${String(e)}`),
        );
        return { outcome: 'duplicate' };
      }
      throw err;
    }
  }

  async getCursor(): Promise<string | null> {
    const row = await this.prisma.listenerCursor.findUnique({ where: { id: HORIZON_CURSOR_ID } });
    return row?.cursor ?? null;
  }

  async persistCursor(cursor: string): Promise<void> {
    await this.prisma.listenerCursor.upsert({
      where: { id: HORIZON_CURSOR_ID },
      create: { id: HORIZON_CURSOR_ID, cursor },
      update: { cursor },
    });
  }

  cumulativeReceived(parts: string[]): string {
    return parts.reduce((acc, p) => addUSDC(acc, p), '0.0000000');
  }
}
