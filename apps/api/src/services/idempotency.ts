import crypto from "crypto";
import { prisma } from "@chronus/db";

interface IdempotentOptions<T> {
  organizationId: string;
  action: string;
  idempotencyKey: string;
  payload: any;
  handler: (tx: any) => Promise<{ statusCode: number; body: T }>;
}

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

/**
 * Executes a business handler idempotently using the IdempotencyKey model.
 * 
 * Flow:
 * 1. Computes the SHA-256 hash of the request payload.
 * 2. Attempts to insert a STARTED record.
 *    - If successful, executes the handler inside a transaction (or passes the tx context).
 *    - If unique constraint violation (key already exists):
 *      - If COMPLETED, validates payload hash. If mismatch, throws 400. Replays cached response.
 *      - If STARTED, returns 409 Conflict.
 *      - If FAILED, updates status to STARTED and runs again.
 */
export async function runIdempotent<T>(
  options: IdempotentOptions<T>
): Promise<IdempotentResult<T>> {
  const { organizationId, action, idempotencyKey, payload, handler } = options;
  let currentLockTimestamp: Date | null = null;

  // 1. Compute request hash
  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");

  let recordId: string | null = null;

  try {
    // 2. Try to insert a STARTED record
    const record = await prisma.idempotencyKey.create({
      data: {
        id: crypto.randomUUID(),
        organizationId,
        action,
        idempotencyKey,
        requestHash,
        status: "STARTED",
      },
    });
    recordId = record.id;
    currentLockTimestamp = record.lockedAt;
  } catch (error: any) {
    if (error.code === "P2002") {
      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          uniqueTenantActionKey: { organizationId, action, idempotencyKey },
        },
      });

      if (!existing) {
        throw new Error("Idempotency conflict detected, but key not found.");
      }

      // Security Check: Failures should also respect payload integrity
      if (existing.requestHash !== requestHash) {
        const err: any = new Error("Idempotency key was already used with a different request payload.");
        err.statusCode = 400;
        throw err;
      }

      if (existing.status === "COMPLETED") {
        return {
          statusCode: existing.responseCode ?? 200,
          body: existing.responseBody as T,
          replayed: true,
        };
      }

      // Prepare conditional optimistic locking query structures
      const updateWhereConditions: any = {
        id: existing.id,
        status: existing.status
      };

      if (existing.status === "STARTED") {
        const LEASE_WINDOW_MS = 30 * 1000; // 30 seconds lease
        const diff = Date.now() - existing.lockedAt.getTime();
        const isLeaseExpired = diff > LEASE_WINDOW_MS;

        // If the process crashed long ago, we can break the lock and attempt to reclaim it below
        if (!isLeaseExpired) {
          const err: any = new Error("A request with this idempotency key is already in progress.");
          err.statusCode = 409;
          throw err;
        }

        // If breaking an expired lock, we MUST assert that lockedAt hasn't changed 
        // down at the database layer since we read it.
        updateWhereConditions.lockedAt = existing.lockedAt;
      }

      // ATOMIC RECLAIM: Handles both explicit FAILED states and expired/stuck STARTED locks safely
      // By using updateMany, we execute a strict conditional atomic query down in Postgres
      const now = new Date()
      const updateResult = await prisma.idempotencyKey.updateMany({
        where: updateWhereConditions,
        data: {
          status: "STARTED",
          requestHash,
          lockedAt: now,
        },
      });

      // If count is 0, another node beat us to re-claiming this record. Act as an active conflict.
      if (updateResult.count === 0) {
        const err: any = new Error("A concurrent retry execution loop claimed this record first.");
        err.statusCode = 409;
        throw err;
      }

      recordId = existing.id;
      currentLockTimestamp = now;
    } else {
      throw error;
    }
  }

  // 3. Execute the business handler
  try {
    const result = await prisma.$transaction(async (tx) => {
      const handlerRes = await handler(tx);

      await tx.idempotencyKey.update({
        where: { id: recordId! },
        data: {
          status: "COMPLETED",
          responseCode: handlerRes.statusCode,
          responseBody: handlerRes.body as any,
        },
      });

      return handlerRes;
    }, {
      // ⚠️ Note: Keep an eye on transaction timeouts if your business handler blocks long-running requests
      timeout: 10000
    });

    return {
      statusCode: result.statusCode,
      body: result.body,
      replayed: false,
    };
  } catch (handlerError: any) {
    if (recordId) {
      try {
        // Ensure we only mark it as FAILED if another instance hasn't 
        // already hijacked or bumped the status/lockedAt state while we were running.
        await prisma.idempotencyKey.updateMany({
          where: { id: recordId, status: "STARTED", lockedAt: currentLockTimestamp },
          data: { status: "FAILED" },
        });
      } catch (dbError) {
        console.error("[Idempotency Service Error] Failed to update key status to FAILED:", dbError);
      }
    }
    throw handlerError;
  }
}
