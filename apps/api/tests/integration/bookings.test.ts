import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app";
import { prisma } from "@chronus/db";
import { createTestToken } from "../helpers/auth";
import { createBookingFixture } from "../fixtures/booking";

describe("POST /api/v1/bookings", () => {
    it("allows only one user to book a slot concurrently", async () => {
        const {
            organization,
            memberA,
            memberB,
            userA,
            userB,
            slot,
        } = await createBookingFixture();

        const tokenA = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        const tokenB = createTestToken({
            membershipId: memberB.id,
            userId: userB.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberB.timezone,
            name: userB.name,
            email: userB.email,
            organizationName: organization.name,
        });

        const [responseA, responseB] = await Promise.all([
            request(app)
                .post("/api/v1/bookings")
                .set("Cookie", [`token=${tokenA}`])
                .set("Idempotency-Key", "member-a-booking")
                .send({
                    slotId: slot.id,
                }),

            request(app)
                .post("/api/v1/bookings")
                .set("Cookie", [`token=${tokenB}`])
                .set("Idempotency-Key", "member-b-booking")
                .send({
                    slotId: slot.id,
                }),
        ]);

        // Exactly one request should win.
        expect(
            [responseA.status, responseB.status].sort(),
        ).toEqual([201, 409]);

        // Exactly one active booking must exist.
        const activeBookings = await prisma.booking.findMany({
            where: {
                slotId: slot.id,
                status: "ACTIVE",
            },
        });

        expect(activeBookings).toHaveLength(1);

        // Slot must be marked as booked.
        const updatedSlot = await prisma.mentorSlot.findUnique({
            where: {
                organizationId_id: {
                    organizationId: organization.id,
                    id: slot.id,
                },
            },
        });

        expect(updatedSlot?.status).toBe("BOOKED");
    });

    it("returns the existing booking when the same idempotency key is retried", async () => {
        const {
            organization,
            memberA,
            userA,
            slot,
        } = await createBookingFixture();

        const token = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        const idempotencyKey = "same-booking-request";

        const firstResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                slotId: slot.id,
            });

        expect(firstResponse.status).toBe(201);

        const bookingId = firstResponse.body.id;

        const secondResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                slotId: slot.id,
            });

        expect(secondResponse.status).toBe(200);

        expect(secondResponse.headers["x-idempotent-replayed"])
            .toBe("true");

        expect(secondResponse.body.id).toBe(bookingId);

        const bookings = await prisma.booking.findMany({
            where: {
                slotId: slot.id,
                status: "ACTIVE",
            },
        });

        expect(bookings).toHaveLength(1);
    });

    it("handles concurrent requests with the same idempotency key", async () => {
        const {
            organization,
            memberA,
            userA,
            slot,
        } = await createBookingFixture();

        const token = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        const idempotencyKey = "concurrent-key";

        const [responseA, responseB] = await Promise.all([
            request(app)
                .post("/api/v1/bookings")
                .set("Cookie", [`token=${token}`])
                .set("Idempotency-Key", idempotencyKey)
                .send({ slotId: slot.id }),

            request(app)
                .post("/api/v1/bookings")
                .set("Cookie", [`token=${token}`])
                .set("Idempotency-Key", idempotencyKey)
                .send({ slotId: slot.id }),
        ]);

        // Desired behavior:
        expect(
            [responseA.status, responseB.status].sort(),
        ).toEqual([200, 201]);

        const bookings = await prisma.booking.findMany({
            where: {
                slotId: slot.id,
                status: "ACTIVE",
            },
        });

        expect(bookings).toHaveLength(1);

        expect(responseA.body.id).toBe(responseB.body.id);
    });

    it("rejects booking a slot if the member already has an active booking at the same time with a different mentor", async () => {
        const {
            organization,
            memberA,
            userA,
            slot, // Slot with Mentor A
        } = await createBookingFixture();

        // 1. Create a second mentor in the same organization
        const mentorUserB = await prisma.user.create({
            data: {
                email: `mentor-b-${crypto.randomUUID()}@test.com`,
                name: "Mentor B",
            },
        });

        const mentorB = await prisma.organizationUser.create({
            data: {
                organizationId: organization.id,
                userId: mentorUserB.id,
                timezone: "Asia/Kolkata",
                isMentor: true,
            },
        });

        // 2. Create an AVAILABLE slot with Mentor B at the exact same time
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentorB.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                status: "AVAILABLE",
            },
        });

        // 3. Pre-book slotB for memberA
        await prisma.booking.create({
            data: {
                organizationId: organization.id,
                memberId: memberA.id,
                slotId: slotB.id,
                status: "ACTIVE",
                idempotencyKey: "pre-booked-slot-b",
            },
        });

        const token = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        // 4. Attempt to book Mentor A's slot at the same time
        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-attempt-overlapping")
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("overlaps");
    });

    it("Member can book available slot", async () => {
        const {
            organization,
            memberA,
            userA,
            slot,
        } = await createBookingFixture();

        const token = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "member-can-book-slot")
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(201);
        expect(response.body.slot.id).toBe(slot.id);
        expect(response.body.status).toBe("ACTIVE");

        // Verify slot status in DB
        const updatedSlot = await prisma.mentorSlot.findUnique({
            where: {
                organizationId_id: {
                    organizationId: organization.id,
                    id: slot.id,
                },
            },
        });
        expect(updatedSlot?.status).toBe("BOOKED");
    });

    it("Mentor cannot book own slot", async () => {
        const {
            organization,
            mentor,
            mentorUser,
            slot,
        } = await createBookingFixture();

        // Token of the mentor
        const mentorToken = createTestToken({
            membershipId: mentor.id,
            userId: mentorUser.id,
            organizationId: organization.id,
            isMentor: true,
            timezone: mentor.timezone,
            name: mentorUser.name,
            email: mentorUser.email,
            organizationName: organization.name,
        });

        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${mentorToken}`])
            .set("Idempotency-Key", "mentor-cannot-book-own-slot")
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("You cannot book your own mentor slot");
    });

    it("Cannot book unavailable slot", async () => {
        const {
            organization,
            memberA,
            userA,
            slot,
        } = await createBookingFixture();

        // Mark slot as already booked
        await prisma.mentorSlot.update({
            where: {
                organizationId_id: {
                    organizationId: organization.id,
                    id: slot.id,
                },
            },
            data: {
                status: "BOOKED",
            },
        });

        const token = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organization.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organization.name,
        });

        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "cannot-book-unavailable")
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(409);
        expect(response.body.error).toContain("Slot is no longer available");
    });

    it("Cannot book slot belonging to another organization", async () => {
        const {
            slot, // Slot in Organization A
        } = await createBookingFixture();

        // Create Organization B and a user in it
        const organizationB = await prisma.organization.create({
            data: {
                name: "Organization B",
            },
        });

        const userB = await prisma.user.create({
            data: {
                email: `member-b-${crypto.randomUUID()}@test.com`,
                name: "Member B",
            },
        });

        const memberB = await prisma.organizationUser.create({
            data: {
                organizationId: organizationB.id,
                userId: userB.id,
                timezone: "Asia/Kolkata",
                isMentor: false,
            },
        });

        const tokenB = createTestToken({
            membershipId: memberB.id,
            userId: userB.id,
            organizationId: organizationB.id,
            isMentor: false,
            timezone: memberB.timezone,
            name: userB.name,
            email: userB.email,
            organizationName: organizationB.name,
        });

        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${tokenB}`])
            .set("Idempotency-Key", "cannot-book-cross-org")
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(404);
        expect(response.body.error).toContain("Slot not found");
    });
});
describe("GET /api/v1/bookings", () => {
    it("Organization A cannot see Organization B bookings", async () => {
        const {
            organization: organizationA,
            memberA,
            userA,
            slot: slotA,
        } = await createBookingFixture();

        // Create Org A booking
        const tokenA = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organizationA.id,
            isMentor: false,
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organizationA.name,
        });

        await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${tokenA}`])
            .set("Idempotency-Key", "org-a-booking")
            .send({
                slotId: slotA.id,
            });

        // Verify Org A can see the booking
        const responseA = await request(app)
            .get("/api/v1/bookings")
            .set("Cookie", [`token=${tokenA}`]);

        expect(responseA.status).toBe(200);
        expect(responseA.body).toHaveLength(1);
        expect(responseA.body[0].slot.id).toBe(slotA.id);

        // Create Org B for the SAME user
        const organizationB = await prisma.organization.create({
            data: { name: "Organization B" },
        });

        const memberB = await prisma.organizationUser.create({
            data: {
                organizationId: organizationB.id,
                userId: userA.id,
                timezone: "Asia/Kolkata",
                isMentor: false,
            },
        });

        const tokenB = createTestToken({
            membershipId: memberB.id,
            userId: userA.id,
            organizationId: organizationB.id,
            isMentor: false,
            timezone: memberB.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organizationB.name,
        });

        // Verify Org B cannot see Org A's booking
        const responseB = await request(app)
            .get("/api/v1/bookings")
            .set("Cookie", [`token=${tokenB}`]);

        expect(responseB.status).toBe(200);
        expect(responseB.body).toHaveLength(0);
    });
});
