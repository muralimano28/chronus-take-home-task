import { prisma } from "@chronus/db";
import { env } from "./config/env";

export interface ClaimedOutboxEvent {
  id: string;
  correlationId: string;
  eventType: string;
  aggregateId: string;
  payload: any;
  status: string;
  retryCount: number;
  lockedAt: Date | null;
  createdAt: Date;
  publishedAt: Date | null;
}

/**
 * Atomically claims up to `batchSize` pending or expired lease OutboxEvent records via a single CTE statement.
 * Uses PostgreSQL's FOR UPDATE SKIP LOCKED to lease records for `visibilityTimeoutSeconds` safely across
 * multiple concurrent worker replicas without holding open database transactions during external RabbitMQ calls.
 */
export async function claimOutboxBatch(
  batchSize: number = env.BATCH_SIZE,
  visibilityTimeoutSeconds: number = env.VISIBILITY_TIMEOUT_SECONDS
): Promise<ClaimedOutboxEvent[]> {
  return prisma.$queryRaw<ClaimedOutboxEvent[]>`
    WITH claimed AS (
      SELECT id
      FROM "OutboxEvent"
      WHERE status = 'PENDING'
         OR (status = 'PROCESSING' AND "lockedAt" < NOW() - (${visibilityTimeoutSeconds} || ' seconds')::interval)
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent"
    SET
      status = 'PROCESSING',
      "lockedAt" = NOW(),
      "retryCount" = "retryCount" + 1
    FROM claimed
    WHERE "OutboxEvent".id = claimed.id
    RETURNING
      "OutboxEvent".id,
      "OutboxEvent"."correlationId",
      "OutboxEvent"."eventType",
      "OutboxEvent"."aggregateId",
      "OutboxEvent".payload,
      "OutboxEvent".status,
      "OutboxEvent"."retryCount",
      "OutboxEvent"."lockedAt",
      "OutboxEvent"."createdAt",
      "OutboxEvent"."publishedAt"
  `;
}
