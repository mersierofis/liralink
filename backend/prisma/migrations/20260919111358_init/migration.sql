-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('open', 'underpaid', 'paid', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PayRail" AS ENUM ('contract', 'memo', 'x402');

-- CreateEnum
CREATE TYPE "SettleStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "WdStatus" AS ENUM ('requested', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AnchorProvider" AS ENUM ('mock', 'sep6', 'sep24');

-- CreateEnum
CREATE TYPE "SettleFailReason" AS ENUM ('unexpected_fee_asset', 'invalid_fee', 'anchor_status', 'amount_mismatch');

-- CreateEnum
CREATE TYPE "AnchorBlockedReason" AS ENUM ('missing_iban', 'outside_anchor_limits', 'anchor_withdraw_disabled');

-- CreateEnum
CREATE TYPE "PaymentAttemptReason" AS ENUM ('link_not_open', 'link_not_found', 'unmatched_memo', 'wrong_asset');

-- CreateEnum
CREATE TYPE "UnallocatedSource" AS ENUM ('stray', 'overpaid');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "iban" TEXT,
    "autoSavePercent" INTEGER NOT NULL DEFAULT 0,
    "unallocatedUSDC" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "merchantId" UUID NOT NULL,
    "merchantName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountTRY" DECIMAL(20,7) NOT NULL,
    "quotedUSDC" DECIMAL(20,7) NOT NULL,
    "fxRate" DECIMAL(20,7) NOT NULL,
    "quoteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'open',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedUSDC" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "shortfallUSDC" DECIMAL(20,7),
    "onchainContractId" TEXT,
    "onchainInvoiceCode" TEXT,
    "onchainDeadlineLedger" INTEGER,
    "onchainTxHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "rail" "PayRail" NOT NULL,
    "txHash" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "amountUSDC" DECIMAL(20,7) NOT NULL,
    "ledger" INTEGER NOT NULL,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "linkCode" TEXT,
    "merchantId" UUID,
    "txHash" TEXT NOT NULL,
    "amount" DECIMAL(20,7) NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetIssuer" TEXT,
    "reason" "PaymentAttemptReason" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnallocatedCredit" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "source" "UnallocatedSource" NOT NULL,
    "txHash" TEXT NOT NULL,
    "amountUSDC" DECIMAL(20,7) NOT NULL,
    "linkCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnallocatedCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountUSDC" DECIMAL(20,7) NOT NULL,
    "amountTRY" DECIMAL(20,7) NOT NULL,
    "fxRate" DECIMAL(20,7) NOT NULL,
    "savedUSDC" DECIMAL(20,7) NOT NULL,
    "feeUSDC" DECIMAL(20,7),
    "netTRY" DECIMAL(20,7),
    "provider" "AnchorProvider" NOT NULL,
    "status" "SettleStatus" NOT NULL DEFAULT 'pending',
    "anchorRef" TEXT,
    "failReason" "SettleFailReason",
    "blockedReason" "AnchorBlockedReason",
    "interactiveUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "amountTRY" DECIMAL(20,7) NOT NULL,
    "iban" TEXT NOT NULL,
    "status" "WdStatus" NOT NULL DEFAULT 'requested',
    "anchorRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_code_key" ON "PaymentLink"("code");

-- CreateIndex
CREATE INDEX "PaymentLink_merchantId_createdAt_idx" ON "PaymentLink"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_txHash_key" ON "Payment"("txHash");

-- CreateIndex
CREATE INDEX "Payment_linkId_detectedAt_idx" ON "Payment"("linkId", "detectedAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_txHash_idx" ON "PaymentAttempt"("txHash");

-- CreateIndex
CREATE INDEX "PaymentAttempt_merchantId_createdAt_idx" ON "PaymentAttempt"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "UnallocatedCredit_merchantId_createdAt_idx" ON "UnallocatedCredit"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_paymentId_key" ON "Settlement"("paymentId");

-- CreateIndex
CREATE INDEX "Settlement_merchantId_createdAt_idx" ON "Settlement"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_merchantId_createdAt_idx" ON "Withdrawal"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PaymentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnallocatedCredit" ADD CONSTRAINT "UnallocatedCredit_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
