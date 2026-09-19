-- CreateTable
CREATE TABLE "ProcessedOperation" (
    "opId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOperation_pkey" PRIMARY KEY ("opId")
);

-- CreateTable
CREATE TABLE "ListenerCursor" (
    "stream" TEXT NOT NULL,
    "pagingToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ListenerCursor_pkey" PRIMARY KEY ("stream")
);

-- CreateIndex
CREATE INDEX "ProcessedOperation_txHash_idx" ON "ProcessedOperation"("txHash");
