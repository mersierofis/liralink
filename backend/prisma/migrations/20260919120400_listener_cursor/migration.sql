-- AlterTable
-- CreateTable
CREATE TABLE "ProcessedOperation" (
    "opId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOperation_pkey" PRIMARY KEY ("opId")
);

-- CreateTable
CREATE TABLE "ListenerCursor" (
    "id" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ListenerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedOperation_txHash_idx" ON "ProcessedOperation"("txHash");
