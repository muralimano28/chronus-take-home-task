import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@chronus/db";
import { claimOutboxBatch } from "../src/claim";

describe("Event Publisher Worker - Outbox Concurrency & Duplicate Protection", () => {

  it("ensures concurrent worker replicas claim completely disjoint, non-overlapping event sets with no duplicates", async () => {
    // 1. Seed 20 pending outbox events
    const eventIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const event = await prisma.outboxEvent.create({
        data: {
          correlationId: crypto.randomUUID(),
          eventType: "BOOKING_CREATED",
          aggregateId: crypto.randomUUID(),
          payload: { testIndex: i },
          status: "PENDING",
        },
      });
      eventIds.push(event.id);
    }

    try {
      // 2. Simulate 2 concurrent workers attempting to claim 10 events each at the exact same millisecond
      const [batchWorker1, batchWorker2] = await Promise.all([
        claimOutboxBatch(10),
        claimOutboxBatch(10),
      ]);

      expect(batchWorker1).toHaveLength(10);
      expect(batchWorker2).toHaveLength(10);

      const worker1Ids = new Set(batchWorker1.map((e) => e.id));
      const worker2Ids = new Set(batchWorker2.map((e) => e.id));

      // 3. Verify zero duplicate overlap across workers (intersection is empty)
      const duplicateIds = [...worker1Ids].filter((id) => worker2Ids.has(id));
      expect(duplicateIds).toHaveLength(0);

      // 4. Verify all 20 events transitioned to PROCESSING with active lease
      const allClaimedIds = [...worker1Ids, ...worker2Ids];
      expect(allClaimedIds).toHaveLength(20);

      const eventsInDb = await prisma.outboxEvent.findMany({
        where: { id: { in: allClaimedIds } },
      });

      for (const event of eventsInDb) {
        expect(event.status).toBe("PROCESSING");
        expect(event.retryCount).toBe(1);
        expect(event.lockedAt).not.toBeNull();
      }

      // 5. A 3rd concurrent worker polling immediately gets 0 events
      const batchWorker3 = await claimOutboxBatch(10);
      expect(batchWorker3.filter((e) => allClaimedIds.includes(e.id))).toHaveLength(0);
    } finally {
      // Clean up test events
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: eventIds } },
      });
    }
  });

  it("re-claims and recovers events if the worker crashed and visibility lease expired", async () => {
    // 1. Create an outbox event stuck in PROCESSING with an expired lease (e.g. 90 seconds ago)
    const expiredTimestamp = new Date(Date.now() - 90 * 1000);
    const staleEvent = await prisma.outboxEvent.create({
      data: {
        correlationId: crypto.randomUUID(),
        eventType: "BOOKING_RESCHEDULED",
        aggregateId: crypto.randomUUID(),
        payload: { simulatedCrash: true },
        status: "PROCESSING",
        retryCount: 1,
        lockedAt: expiredTimestamp,
      },
    });

    try {
      // 2. Poll worker claim query
      const claimedBatch = await claimOutboxBatch(10);
      const reclaimed = claimedBatch.find((e) => e.id === staleEvent.id);

      // 3. Verify the stale event was successfully re-claimed
      expect(reclaimed).toBeDefined();
      expect(reclaimed?.status).toBe("PROCESSING");
      expect(reclaimed?.retryCount).toBe(2);
      expect(new Date(reclaimed!.lockedAt!).getTime()).toBeGreaterThan(expiredTimestamp.getTime());
    } finally {
      await prisma.outboxEvent.deleteMany({
        where: { id: staleEvent.id },
      });
    }
  });

  it("does not reclaim an active lease before VISIBILITY_TIMEOUT_SECONDS expires", async () => {
    // 1. Create an outbox event in PROCESSING with an active lease (locked 10 seconds ago)
    const recentTimestamp = new Date(Date.now() - 10 * 1000);
    const activeEvent = await prisma.outboxEvent.create({
      data: {
        correlationId: crypto.randomUUID(),
        eventType: "BOOKING_CANCELLED",
        aggregateId: crypto.randomUUID(),
        payload: { activeWorker: true },
        status: "PROCESSING",
        retryCount: 1,
        lockedAt: recentTimestamp,
      },
    });

    try {
      // 2. Attempt to claim
      const claimedBatch = await claimOutboxBatch(10);
      const claimedActive = claimedBatch.find((e) => e.id === activeEvent.id);

      // 3. Must NOT claim active lease
      expect(claimedActive).toBeUndefined();

      // Status in DB remains unchanged
      const dbRecord = await prisma.outboxEvent.findUnique({
        where: { id: activeEvent.id },
      });
      expect(dbRecord?.status).toBe("PROCESSING");
      expect(dbRecord?.retryCount).toBe(1);
    } finally {
      await prisma.outboxEvent.deleteMany({
        where: { id: activeEvent.id },
      });
    }
  });
});
