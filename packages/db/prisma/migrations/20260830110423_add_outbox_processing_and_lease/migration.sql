-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "OutboxStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "lockedAt" TIMESTAMPTZ,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "publishedAt" SET DATA TYPE TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "OutboxEvent_status_lockedAt_idx" ON "OutboxEvent"("status", "lockedAt");
