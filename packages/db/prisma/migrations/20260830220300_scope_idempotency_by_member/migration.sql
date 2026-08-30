-- DropForeignKey
-- (No previous member foreign key existed on IdempotencyKey)

-- DropIndex
DROP INDEX IF EXISTS "IdempotencyKey_organizationId_action_idempotencyKey_key";
DROP INDEX IF EXISTS "IdempotencyKey_organizationId_idempotencyKey_idx";

-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN "membershipId" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organizationId_membershipId_action_idempotencyKey_key" ON "IdempotencyKey"("organizationId", "membershipId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyKey_organizationId_membershipId_idempotencyKey_idx" ON "IdempotencyKey"("organizationId", "membershipId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
