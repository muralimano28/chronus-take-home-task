import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import app from "../../src/app";
import { prisma } from "@chronus/db";
import { redis } from "@chronus/redis";
import { createTenantFixture } from "../fixtures/tenant";
import { createTestToken } from "../helpers/auth";

describe("Redis Cache-Aside Integration Tests", () => {
  beforeEach(async () => {
    try {
      // Flush test redis before each test to guarantee a clean state
      await redis.flushdb();
    } catch (err) {
      console.warn("Failed to flush redis in test beforeEach:", err);
    }
  });

  it("serves mentor list from Redis cache on subsequent requests", async () => {
    const { organizationA, userA, memberA, mentorA } = await createTenantFixture();
    const token = createTestToken({
      membershipId: memberA.id,
      userId: userA.id,
      organizationId: organizationA.id,
      isMentor: false,
      timezone: memberA.timezone,
      name: userA.name,
      email: userA.email,
      organizationName: organizationA.name,
    });

    // 1. First request - Cache Miss (populates Redis)
    const res1 = await request(app)
      .get("/api/v1/mentors?page=1&limit=10")
      .set("Cookie", [`token=${token}`]);

    expect(res1.status).toBe(200);
    expect(res1.body.data[0].name).toBe("Mentor A");

    // Wait a brief tick for fire-and-forget redis.set to complete
    await new Promise((r) => setTimeout(r, 50));

    // Verify key exists in Redis
    const version = await redis.get(`org:${organizationA.id}:mentors:version`);
    expect(version).toBe("1");
    const cached = await redis.get(`org:${organizationA.id}:mentors:v1:page:1:limit:10`);
    expect(cached).not.toBeNull();

    // 2. Mutate the DB directly behind the API's back
    await prisma.user.update({
      where: { id: mentorA.userId },
      data: { name: "Direct DB Change (Not In Cache)" },
    });

    // 3. Second request - Cache Hit (returns the cached value, NOT the updated DB value)
    const res2 = await request(app)
      .get("/api/v1/mentors?page=1&limit=10")
      .set("Cookie", [`token=${token}`]);

    expect(res2.status).toBe(200);
    expect(res2.body.data[0].name).toBe("Mentor A"); // Confirms cache was served!
  });

  it("invalidates mentor slots cache when a booking is created", async () => {
    const { organizationA, userA, memberA, mentorA } = await createTenantFixture();
    const token = createTestToken({
      membershipId: memberA.id,
      userId: userA.id,
      organizationId: organizationA.id,
      isMentor: false,
      timezone: memberA.timezone,
      name: userA.name,
      email: userA.email,
      organizationName: organizationA.name,
    });

    // Create an available slot in the future
    const slot = await prisma.mentorSlot.create({
      data: {
        organizationId: organizationA.id,
        mentorId: mentorA.id,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
        status: "AVAILABLE",
      },
    });

    // 1. Fetch slots -> populates v1 cache
    const slotsRes1 = await request(app)
      .get(`/api/v1/mentors/${mentorA.id}/slots?range=next_7_days`)
      .set("Cookie", [`token=${token}`]);

    expect(slotsRes1.status).toBe(200);
    expect(slotsRes1.body).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 50));
    const version1 = await redis.get(`org:${organizationA.id}:mentor:${mentorA.id}:slots:version`);
    expect(version1).toBe("1");

    // 2. Book the slot -> triggers bumpMentorSlotsVersion
    const bookingRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `test-cache-book-${Date.now()}`)
      .send({ slotId: slot.id });

    expect(bookingRes.status).toBe(201);

    await new Promise((r) => setTimeout(r, 100));

    // 3. Verify version was bumped to "2"
    const version2 = await redis.get(`org:${organizationA.id}:mentor:${mentorA.id}:slots:version`);
    expect(version2).toBe("2");

    // 4. Fetching slots again returns empty (slot was booked, v2 cache read from DB)
    const slotsRes2 = await request(app)
      .get(`/api/v1/mentors/${mentorA.id}/slots?range=next_7_days`)
      .set("Cookie", [`token=${token}`]);

    expect(slotsRes2.status).toBe(200);
    expect(slotsRes2.body).toHaveLength(0);
  });

  it("invalidates both old and new mentor slots when a booking is rescheduled", async () => {
    const { organizationA, userA, memberA, mentorA } = await createTenantFixture();
    const token = createTestToken({
      membershipId: memberA.id,
      userId: userA.id,
      organizationId: organizationA.id,
      isMentor: false,
      timezone: memberA.timezone,
      name: userA.name,
      email: userA.email,
      organizationName: organizationA.name,
    });

    // Create mentor C in organizationA
    const userC = await prisma.user.create({
      data: {
        email: `mentor-c-${Date.now()}@example.com`,
        name: "Mentor User C",
      },
    });
    const mentorC = await prisma.organizationUser.create({
      data: {
        organizationId: organizationA.id,
        userId: userC.id,
        isMentor: true,
        timezone: "UTC",
      },
    });

    // Slot 1 for Mentor A
    const slot1 = await prisma.mentorSlot.create({
      data: {
        organizationId: organizationA.id,
        mentorId: mentorA.id,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
        status: "AVAILABLE",
      },
    });

    // Slot 2 for Mentor C
    const slot2 = await prisma.mentorSlot.create({
      data: {
        organizationId: organizationA.id,
        mentorId: mentorC.id,
        startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
        status: "AVAILABLE",
      },
    });

    // Initial booking with mentor A
    const bookingRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `initial-book-${Date.now()}`)
      .send({ slotId: slot1.id });

    expect(bookingRes.status).toBe(201);
    const bookingId = bookingRes.body.id;

    // Warm up cache for both mentors
    await request(app).get(`/api/v1/mentors/${mentorA.id}/slots?range=next_7_days`).set("Cookie", [`token=${token}`]);
    await request(app).get(`/api/v1/mentors/${mentorC.id}/slots?range=next_7_days`).set("Cookie", [`token=${token}`]);

    await new Promise((r) => setTimeout(r, 50));
    const mentorAVersionBefore = await redis.get(`org:${organizationA.id}:mentor:${mentorA.id}:slots:version`);
    const mentorCVersionBefore = await redis.get(`org:${organizationA.id}:mentor:${mentorC.id}:slots:version`);

    // Reschedule from Mentor A's slot1 to Mentor C's slot2
    const rescheduleRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/reschedule`)
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `reschedule-${Date.now()}`)
      .send({ newSlotId: slot2.id });

    expect(rescheduleRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    // Both versions should have incremented
    const mentorAVersionAfter = await redis.get(`org:${organizationA.id}:mentor:${mentorA.id}:slots:version`);
    const mentorCVersionAfter = await redis.get(`org:${organizationA.id}:mentor:${mentorC.id}:slots:version`);

    expect(mentorAVersionBefore).not.toBeNull();
    expect(mentorCVersionBefore).not.toBeNull();
    expect(Number(mentorAVersionAfter)).toBe(Number(mentorAVersionBefore) + 1);
    expect(Number(mentorCVersionAfter)).toBe(Number(mentorCVersionBefore) + 1);
  });
});
