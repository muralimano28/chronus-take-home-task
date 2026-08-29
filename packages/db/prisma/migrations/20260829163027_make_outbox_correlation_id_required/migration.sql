/*
  Warnings:

  - Made the column `correlationId` on table `OutboxEvent` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill existing rows that have NULL correlationId with their id
UPDATE "OutboxEvent" SET "correlationId" = "id"::text WHERE "correlationId" IS NULL;

-- AlterTable
ALTER TABLE "OutboxEvent" ALTER COLUMN "correlationId" SET NOT NULL;
