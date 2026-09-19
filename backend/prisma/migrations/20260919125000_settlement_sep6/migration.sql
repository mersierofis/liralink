-- SEP-6 settlement: one settlement per link, resumable anchor state, SEP-12 registration.

-- Anchor "needs more info" states are recorded as (internal) block reasons while in progress.
ALTER TYPE "AnchorBlockedReason" ADD VALUE 'pending_customer_info_update';
ALTER TYPE "AnchorBlockedReason" ADD VALUE 'pending_transaction_info_update';

-- SEP-12 registration at the anchor, with the IBAN and home domain it was made for.
ALTER TABLE "Merchant" ADD COLUMN     "sep12CustomerId" TEXT,
ADD COLUMN     "sep12HomeDomain" TEXT,
ADD COLUMN     "sep12Iban" TEXT;

-- Resumable anchor state, and the link the settlement belongs to (nullable first, for backfill).
ALTER TABLE "Settlement" ADD COLUMN     "anchorMemo" TEXT,
ADD COLUMN     "anchorStatus" TEXT,
ADD COLUMN     "linkId" UUID,
ADD COLUMN     "payMemo" TEXT,
ADD COLUMN     "payMemoType" TEXT,
ADD COLUMN     "payTo" TEXT,
ADD COLUMN     "paymentTxHash" TEXT,
ADD COLUMN     "paymentXdr" TEXT;

UPDATE "Settlement" s SET "linkId" = p."linkId" FROM "Payment" p WHERE p."id" = s."paymentId";
ALTER TABLE "Settlement" ALTER COLUMN "linkId" SET NOT NULL;

-- One settlement per paid link, enforced by the database.
CREATE UNIQUE INDEX "Settlement_linkId_key" ON "Settlement"("linkId");
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PaymentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
