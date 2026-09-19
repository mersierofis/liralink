-- Record what each link was quoted and when (rate source, timestamp, mid rate, spread, raw
-- response), so a receipt can show it. Like the quote itself, written once at link creation.

-- CreateEnum
CREATE TYPE "FxSource" AS ENUM ('mock', 'live', 'anchor');

-- AlterTable: add nullable first, so existing rows can be backfilled.
ALTER TABLE "PaymentLink" ADD COLUMN     "fxMidRate" DECIMAL(20,7),
ADD COLUMN     "fxQuoteRaw" JSON,
ADD COLUMN     "fxRateAt" TIMESTAMPTZ(3),
ADD COLUMN     "fxSource" "FxSource",
ADD COLUMN     "fxSpread" DECIMAL(20,7);

-- Backfill: every link before this migration was priced by the mock provider, the only one that
-- existed. Its rate had no spread and was read at creation time.
UPDATE "PaymentLink"
SET "fxSource" = 'mock', "fxRateAt" = "createdAt", "fxMidRate" = "fxRate", "fxSpread" = 0;

ALTER TABLE "PaymentLink" ALTER COLUMN "fxMidRate" SET NOT NULL,
ALTER COLUMN "fxRateAt" SET NOT NULL,
ALTER COLUMN "fxSource" SET NOT NULL;
