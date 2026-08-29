import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "@chronus/db";
import { formatTimeInTimezone } from "@chronus/utils";
import { createTenantFixture } from "../fixtures/tenant";
import { createTestToken } from "../helpers/auth";

describe("Timezone & Daylight Saving Time (DST) Integration Tests", () => {
  it("stores and queries slots accurately in UTC across US DST transitions (EST <-> EDT)", async () => {
    const { organizationA, userA, memberA, mentorA } = await createTenantFixture();
    const token = createTestToken({
      membershipId: memberA.id,
      userId: userA.id,
      organizationId: organizationA.id,
      isMentor: false,
      timezone: memberA.timezone, // "Asia/Kolkata" (+05:30)
      name: userA.name,
      email: userA.email,
      organizationName: organizationA.name,
    });

    // In US Eastern Time (America/New_York):
    // Standard Time (EST): UTC-5 (e.g. Jan 15)
    // Daylight Saving Time (EDT): UTC-4 (e.g. Jul 15)
    // Mentor scheduled 10:00 AM local time in New York:
    // - Winter (EST): 10:00 AM EST = 15:00:00 UTC (10 + 5)
    // - Summer (EDT): 10:00 AM EDT = 14:00:00 UTC (10 + 4)
    const winterSlotStart = new Date("2027-01-15T15:00:00.000Z");
    const winterSlotEnd = new Date("2027-01-15T16:00:00.000Z");

    const summerSlotStart = new Date("2027-07-15T14:00:00.000Z");
    const summerSlotEnd = new Date("2027-07-15T15:00:00.000Z");

    const [slotWinter, slotSummer] = await Promise.all([
      prisma.mentorSlot.create({
        data: {
          organizationId: organizationA.id,
          mentorId: mentorA.id,
          startTime: winterSlotStart,
          endTime: winterSlotEnd,
          status: "AVAILABLE",
        },
      }),
      prisma.mentorSlot.create({
        data: {
          organizationId: organizationA.id,
          mentorId: mentorA.id,
          startTime: summerSlotStart,
          endTime: summerSlotEnd,
          status: "AVAILABLE",
        },
      }),
    ]);

    // 1. Fetch winter slot with custom date filter
    const winterRes = await request(app)
      .get(`/api/v1/mentors/${mentorA.id}/slots?startDate=2027-01-15T00:00:00.000Z&endDate=2027-01-15T23:59:59.999Z`)
      .set("Cookie", [`token=${token}`]);

    expect(winterRes.status).toBe(200);
    expect(winterRes.body).toHaveLength(1);
    expect(winterRes.body[0].id).toBe(slotWinter.id);
    expect(new Date(winterRes.body[0].startTime).toISOString()).toBe("2027-01-15T15:00:00.000Z");

    // 2. Fetch summer slot with custom date filter
    const summerRes = await request(app)
      .get(`/api/v1/mentors/${mentorA.id}/slots?startDate=2027-07-15T00:00:00.000Z&endDate=2027-07-15T23:59:59.999Z`)
      .set("Cookie", [`token=${token}`]);

    expect(summerRes.status).toBe(200);
    expect(summerRes.body).toHaveLength(1);
    expect(summerRes.body[0].id).toBe(slotSummer.id);
    expect(new Date(summerRes.body[0].startTime).toISOString()).toBe("2027-07-15T14:00:00.000Z");

    // 3. Verify client timezone formatting (formatters evaluate to 10:00 AM in America/New_York regardless of DST)
    expect(formatTimeInTimezone(new Date(slotWinter.startTime), "America/New_York")).toBe("10:00 AM");
    expect(formatTimeInTimezone(new Date(slotSummer.startTime), "America/New_York")).toBe("10:00 AM");

    // In India (Asia/Kolkata, no DST, fixed UTC+5:30):
    // Winter (15:00 UTC) -> 8:30 PM
    // Summer (14:00 UTC) -> 7:30 PM
    expect(formatTimeInTimezone(new Date(slotWinter.startTime), "Asia/Kolkata")).toBe("8:30 PM");
    expect(formatTimeInTimezone(new Date(slotSummer.startTime), "Asia/Kolkata")).toBe("7:30 PM");
  });

  it("handles UK DST transition (GMT <-> BST) without timezone drift during bookings", async () => {
    const { organizationB, userB, memberB, mentorB } = await createTenantFixture();
    const token = createTestToken({
      membershipId: memberB.id,
      userId: userB.id,
      organizationId: organizationB.id,
      isMentor: false,
      timezone: memberB.timezone, // "America/New_York"
      name: userB.name,
      email: userB.email,
      organizationName: organizationB.name,
    });

    // mentorB is in "Europe/London":
    // 2:00 PM local time for Mentor B:
    // - Winter (GMT / UTC+0, e.g. Feb 10): 2:00 PM GMT = 14:00:00 UTC (14 - 0)
    // - Summer (BST / UTC+1, e.g. Jun 10): 2:00 PM BST = 13:00:00 UTC (14 - 1)
    const [winterSlot, summerSlot] = await Promise.all([
      prisma.mentorSlot.create({
        data: {
          organizationId: organizationB.id,
          mentorId: mentorB.id,
          startTime: new Date("2027-02-10T14:00:00.000Z"),
          endTime: new Date("2027-02-10T15:00:00.000Z"),
          status: "AVAILABLE",
        },
      }),
      prisma.mentorSlot.create({
        data: {
          organizationId: organizationB.id,
          mentorId: mentorB.id,
          startTime: new Date("2027-06-10T13:00:00.000Z"),
          endTime: new Date("2027-06-10T14:00:00.000Z"),
          status: "AVAILABLE",
        },
      }),
    ]);

    // 1. Member in America/New_York books the Winter (GMT) slot
    const winterBookRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `dst-uk-winter-${Date.now()}`)
      .send({ slotId: winterSlot.id });

    expect(winterBookRes.status).toBe(201);
    expect(winterBookRes.body.slot.startTime).toBe("2027-02-10T14:00:00.000Z");

    // 2. Member in America/New_York books the Summer (BST) slot
    const summerBookRes = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `dst-uk-summer-${Date.now()}`)
      .send({ slotId: summerSlot.id });

    expect(summerBookRes.status).toBe(201);
    expect(summerBookRes.body.slot.startTime).toBe("2027-06-10T13:00:00.000Z");

    // 3. Verify local time rendering in London (Europe/London):
    // Both winter and summer sessions reflect 2:00 PM local wall-clock time for the London mentor
    const winterDate = new Date(winterBookRes.body.slot.startTime);
    const summerDate = new Date(summerBookRes.body.slot.startTime);

    expect(formatTimeInTimezone(winterDate, "Europe/London")).toBe("2:00 PM"); // 14:00 UTC in GMT (UTC+0)
    expect(formatTimeInTimezone(summerDate, "Europe/London")).toBe("2:00 PM"); // 13:00 UTC in BST (UTC+1)

    // 4. Verify local time rendering in New York (America/New_York):
    // Winter (Feb): 14:00 UTC in EST (UTC-5) = 9:00 AM
    // Summer (Jun): 13:00 UTC in EDT (UTC-4) = 9:00 AM
    expect(formatTimeInTimezone(winterDate, "America/New_York")).toBe("9:00 AM");
    expect(formatTimeInTimezone(summerDate, "America/New_York")).toBe("9:00 AM");
  });

  it("detects cross-timezone member overlapping slots accurately regardless of user timezones", async () => {
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

    // Slot 1: 10:00 - 11:00 UTC
    const slot1 = await prisma.mentorSlot.create({
      data: {
        organizationId: organizationA.id,
        mentorId: mentorA.id,
        startTime: new Date("2027-03-20T10:00:00.000Z"),
        endTime: new Date("2027-03-20T11:00:00.000Z"),
        status: "AVAILABLE",
      },
    });

    // Slot 2: 10:30 - 11:30 UTC (Overlapping in UTC absolute timeline)
    const slot2 = await prisma.mentorSlot.create({
      data: {
        organizationId: organizationA.id,
        mentorId: mentorA.id,
        startTime: new Date("2027-03-20T10:30:00.000Z"),
        endTime: new Date("2027-03-20T11:30:00.000Z"),
        status: "AVAILABLE",
      },
    });

    // Book slot 1
    const res1 = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `overlap-1-${Date.now()}`)
      .send({ slotId: slot1.id });

    expect(res1.status).toBe(201);

    // Attempting to book slot 2 must be rejected because it overlaps in absolute UTC time
    const res2 = await request(app)
      .post("/api/v1/bookings")
      .set("Cookie", [`token=${token}`])
      .set("Idempotency-Key", `overlap-2-${Date.now()}`)
      .send({ slotId: slot2.id });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/overlap/i);
  });
});
