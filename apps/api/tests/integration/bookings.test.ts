import request from "supertest";
import { describe, expect, it } from "vitest";
import crypto from "crypto";

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

    it("rejects request if the same idempotency key is retried with a different slotId", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot,
        } = await createBookingFixture();

        // Create a second slot
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: new Date(slot.startTime.getTime() + 2 * 60 * 60 * 1000),
                endTime: new Date(slot.endTime.getTime() + 2 * 60 * 60 * 1000),
                status: "AVAILABLE",
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

        const idempotencyKey = "mismatch-payload-key";

        // 1. First booking request (Slot A)
        const firstResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                slotId: slot.id,
            });

        expect(firstResponse.status).toBe(201);

        // 2. Retry with same key but Slot B
        const secondResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                slotId: slotB.id,
            });

        expect(secondResponse.status).toBe(400);
        expect(secondResponse.body.error).toContain("Idempotency key was already used with a different request payload");
    });

    it("reclaims an idempotency key lock if the lease window has expired (STARTED state)", async () => {
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

        const idempotencyKey = "expired-lease-key";

        // Pre-create the idempotency key in STARTED state with lockedAt set in the past (e.g. 40 seconds ago)
        const expiredTime = new Date(Date.now() - 40 * 1000);
        await prisma.idempotencyKey.create({
            data: {
                id: crypto.randomUUID(),
                organizationId: organization.id,
                action: "create_booking",
                idempotencyKey,
                requestHash: crypto.createHash("sha256").update(JSON.stringify({ slotId: slot.id })).digest("hex"),
                status: "STARTED",
                lockedAt: expiredTime,
                updatedAt: expiredTime,
            },
        });

        // Execute the request. It should succeed (201 Created) because the lease has expired and it is reclaimed
        const response = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                slotId: slot.id,
            });

        expect(response.status).toBe(201);
        expect(response.body.status).toBe("ACTIVE");

        // Verify the key is now COMPLETED in db
        const keyInDb = await prisma.idempotencyKey.findUnique({
            where: {
                uniqueTenantActionKey: {
                    organizationId: organization.id,
                    action: "create_booking",
                    idempotencyKey,
                },
            },
        });

        expect(keyInDb?.status).toBe("COMPLETED");
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

    it("Cannot book slot in the past", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
        } = await createBookingFixture();

        // Create a slot in the past
        const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const pastEnd = new Date(Date.now() - 1.5 * 60 * 60 * 1000);
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: pastStart,
                endTime: pastEnd,
                status: "AVAILABLE",
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
            .set("Idempotency-Key", "cannot-book-past-slot")
            .send({
                slotId: slotB.id,
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("Cannot book a slot in the past");
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

describe("POST /api/v1/bookings/:bookingId/cancel", () => {
    it("allows a member to cancel their own active booking, freeing up the slot", async () => {
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

        // 1. Create a booking first
        const createResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-to-cancel")
            .send({
                slotId: slot.id,
            });

        expect(createResponse.status).toBe(201);
        const bookingId = createResponse.body.id;

        // Verify slot is BOOKED in db
        let slotInDb = await prisma.mentorSlot.findUnique({
            where: { organizationId_id: { organizationId: organization.id, id: slot.id } },
        });
        expect(slotInDb?.status).toBe("BOOKED");

        // 2. Cancel the booking
        const cancelResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/cancel`)
            .set("Cookie", [`token=${token}`]);

        expect(cancelResponse.status).toBe(200);
        expect(cancelResponse.body.status).toBe("CANCELLED");

        // Verify slot is AVAILABLE in db
        slotInDb = await prisma.mentorSlot.findUnique({
            where: { organizationId_id: { organizationId: organization.id, id: slot.id } },
        });
        expect(slotInDb?.status).toBe("AVAILABLE");

        // Verify booking is CANCELLED in db
        const bookingInDb = await prisma.booking.findUnique({
            where: { id: bookingId },
        });
        expect(bookingInDb?.status).toBe("CANCELLED");
    });

    it("rejects cancellation if the booking belongs to another member", async () => {
        const {
            organization,
            memberA,
            userA,
            memberB,
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

        // 1. Member A books the slot
        const createResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${tokenA}`])
            .set("Idempotency-Key", "member-a-booking-cancel-test")
            .send({
                slotId: slot.id,
            });

        expect(createResponse.status).toBe(201);
        const bookingId = createResponse.body.id;

        // 2. Member B attempts to cancel Member A's booking
        const cancelResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/cancel`)
            .set("Cookie", [`token=${tokenB}`]);

        expect(cancelResponse.status).toBe(404);
        expect(cancelResponse.body.error).toContain("Booking not found");

        // Verify booking is still ACTIVE in db
        const bookingInDb = await prisma.booking.findUnique({
            where: { id: bookingId },
        });
        expect(bookingInDb?.status).toBe("ACTIVE");
    });

    it("allows idempotent cancellations (cancelling an already cancelled booking returns 200)", async () => {
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

        // 1. Create booking
        const createResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "idempotent-cancel-test")
            .send({
                slotId: slot.id,
            });

        const bookingId = createResponse.body.id;

        // 2. First cancellation
        const firstCancel = await request(app)
            .post(`/api/v1/bookings/${bookingId}/cancel`)
            .set("Cookie", [`token=${token}`]);

        expect(firstCancel.status).toBe(200);
        expect(firstCancel.body.status).toBe("CANCELLED");

        // 3. Second cancellation (idempotent no-op)
        const secondCancel = await request(app)
            .post(`/api/v1/bookings/${bookingId}/cancel`)
            .set("Cookie", [`token=${token}`]);

        expect(secondCancel.status).toBe(200);
        expect(secondCancel.body.status).toBe("CANCELLED");
    });

    it("rejects cancellation if the booking slot is in the past", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
        } = await createBookingFixture();

        // Create a slot in the past
        const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const pastEnd = new Date(Date.now() - 1.5 * 60 * 60 * 1000);
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: pastStart,
                endTime: pastEnd,
                status: "BOOKED", // Pre-booked
            },
        });

        // Create booking for this past slot
        const booking = await prisma.booking.create({
            data: {
                organizationId: organization.id,
                memberId: memberA.id,
                slotId: slotB.id,
                status: "ACTIVE",
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

        // Attempt to cancel the booking
        const cancelResponse = await request(app)
            .post(`/api/v1/bookings/${booking.id}/cancel`)
            .set("Cookie", [`token=${token}`]);

        expect(cancelResponse.status).toBe(400);
        expect(cancelResponse.body.error).toContain("Cannot cancel a booking for a slot in the past");
    });

    it("allows a member to book a slot that was previously cancelled", async () => {
        const {
            organization,
            memberA,
            userA,
            memberB,
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

        // 1. Member A books the slot
        const createResponseA = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${tokenA}`])
            .set("Idempotency-Key", "booking-attempt-1")
            .send({
                slotId: slot.id,
            });

        expect(createResponseA.status).toBe(201);
        const bookingIdA = createResponseA.body.id;

        // 2. Member A cancels the booking
        const cancelResponse = await request(app)
            .post(`/api/v1/bookings/${bookingIdA}/cancel`)
            .set("Cookie", [`token=${tokenA}`]);

        expect(cancelResponse.status).toBe(200);

        // 3. Member B books the exact same slot
        const createResponseB = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${tokenB}`])
            .set("Idempotency-Key", "booking-attempt-2")
            .send({
                slotId: slot.id,
            });

        expect(createResponseB.status).toBe(201);
        expect(createResponseB.body.status).toBe("ACTIVE");
        expect(createResponseB.body.slot.id).toBe(slot.id);

        // Verify we have 1 cancelled booking and 1 active booking in DB for this slot
        const activeBookings = await prisma.booking.findMany({
            where: { slotId: slot.id, status: "ACTIVE" },
        });
        const cancelledBookings = await prisma.booking.findMany({
            where: { slotId: slot.id, status: "CANCELLED" },
        });

        expect(activeBookings).toHaveLength(1);
        expect(cancelledBookings).toHaveLength(1);
    });
});

describe("POST /api/v1/bookings/:bookingId/reschedule", () => {
    it("allows a member to reschedule an active booking to another available slot in the same org", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot, // Original slot
        } = await createBookingFixture();

        // 1. Create a second slot for the same mentor at a different time
        const futureTimeStart = new Date(slot.startTime.getTime() + 2 * 60 * 60 * 1000);
        const futureTimeEnd = new Date(slot.endTime.getTime() + 2 * 60 * 60 * 1000);
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: futureTimeStart,
                endTime: futureTimeEnd,
                status: "AVAILABLE",
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

        // 2. Book slot A
        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-to-reschedule")
            .send({
                slotId: slot.id,
            });

        expect(bookingResponse.status).toBe(201);
        const bookingId = bookingResponse.body.id;

        // 3. Reschedule booking to slot B
        const rescheduleResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-active-booking")
            .send({
                newSlotId: slotB.id,
            });

        expect(rescheduleResponse.status).toBe(200);
        expect(rescheduleResponse.body.id).toBe(bookingId); // Keeps the SAME booking ID
        expect(rescheduleResponse.body.slot.id).toBe(slotB.id);

        // Verify status updates in DB
        const oldSlot = await prisma.mentorSlot.findUnique({
            where: { organizationId_id: { organizationId: organization.id, id: slot.id } },
        });
        const newSlot = await prisma.mentorSlot.findUnique({
            where: { organizationId_id: { organizationId: organization.id, id: slotB.id } },
        });
        const bookingInDb = await prisma.booking.findUnique({
            where: { id: bookingId },
        });

        expect(oldSlot?.status).toBe("AVAILABLE"); // Freed
        expect(newSlot?.status).toBe("BOOKED");    // Reserved
        expect(bookingInDb?.slotId).toBe(slotB.id);
    });

    it("rejects reschedule if the new slot belongs to a different organization", async () => {
        const {
            organization: organizationA,
            memberA,
            userA,
            slot: slotA,
        } = await createBookingFixture();

        // Create Org B
        const organizationB = await prisma.organization.create({
            data: { name: "Organization B" },
        });

        const mentorUserB = await prisma.user.create({
            data: {
                email: `mentor-b-${crypto.randomUUID()}@test.com`,
                name: "Mentor B",
            },
        });

        const mentorB = await prisma.organizationUser.create({
            data: {
                organizationId: organizationB.id,
                userId: mentorUserB.id,
                timezone: "Asia/Kolkata",
                isMentor: true,
            },
        });

        // Create a slot in Org B
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationB.id,
                mentorId: mentorB.id,
                startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
                endTime: new Date(Date.now() + 24.5 * 60 * 60 * 1000),
                status: "AVAILABLE",
            },
        });

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

        // 1. Create booking in Org A
        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-cross-org-reschedule")
            .send({
                slotId: slotA.id,
            });

        expect(bookingResponse.status).toBe(201);
        const bookingId = bookingResponse.body.id;

        // 2. Attempt reschedule to slot B in Org B
        const rescheduleResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-cross-org")
            .send({
                newSlotId: slotB.id,
            });

        expect(rescheduleResponse.status).toBe(400);
        expect(rescheduleResponse.body.error).toContain("New slot not found in your organization");
    });

    it("rejects reschedule if the new slot is already booked", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot: slotA,
        } = await createBookingFixture();

        // 1. Create slot B
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: new Date(slotA.startTime.getTime() + 2 * 60 * 60 * 1000),
                endTime: new Date(slotA.endTime.getTime() + 2 * 60 * 60 * 1000),
                status: "BOOKED", // Already booked
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

        // 2. Book slot A
        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-to-reschedule-booked")
            .send({
                slotId: slotA.id,
            });

        const bookingId = bookingResponse.body.id;

        // 3. Attempt reschedule to slot B
        const rescheduleResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-booked-slot")
            .send({
                newSlotId: slotB.id,
            });

        expect(rescheduleResponse.status).toBe(409);
        expect(rescheduleResponse.body.error).toContain("already booked");
    });

    it("rejects reschedule if it causes overlapping active bookings for the member", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot: slotA, // Time A
        } = await createBookingFixture();

        // 1. Create slot B (Time B) and slot C (Time B, different mentor)
        const timeBStart = new Date(slotA.startTime.getTime() + 2 * 60 * 60 * 1000);
        const timeBEnd = new Date(slotA.endTime.getTime() + 2 * 60 * 60 * 1000);

        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: timeBStart,
                endTime: timeBEnd,
                status: "AVAILABLE",
            },
        });

        const mentorUserC = await prisma.user.create({
            data: {
                email: `mentor-c-${crypto.randomUUID()}@test.com`,
                name: "Mentor C",
            },
        });

        const mentorC = await prisma.organizationUser.create({
            data: {
                organizationId: organization.id,
                userId: mentorUserC.id,
                timezone: "Asia/Kolkata",
                isMentor: true,
            },
        });

        const slotC = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentorC.id,
                startTime: timeBStart,
                endTime: timeBEnd,
                status: "AVAILABLE",
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

        // 2. Book slotA (Booking 1, Time A)
        const bookingResponseA = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-overlap-reschedule-1")
            .send({
                slotId: slotA.id,
            });
        const bookingId1 = bookingResponseA.body.id;

        // 3. Book slotB (Booking 2, Time B)
        const bookingResponseB = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "booking-overlap-reschedule-2")
            .send({
                slotId: slotB.id,
            });
        expect(bookingResponseB.status).toBe(201);

        // 4. Try to reschedule Booking 1 (currently at Time A) to slotC (Time B, same time as Booking 2)
        const rescheduleResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId1}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-overlap")
            .send({
                newSlotId: slotC.id,
            });

        expect(rescheduleResponse.status).toBe(400);
        expect(rescheduleResponse.body.error).toContain("overlaps");
    });

    it("rejects reschedule if the new slot is in the past", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot,
        } = await createBookingFixture();

        // Create a slot in the past
        const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const pastEnd = new Date(Date.now() - 1.5 * 60 * 60 * 1000);
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: pastStart,
                endTime: pastEnd,
                status: "AVAILABLE",
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

        // 1. Book the original slot (which is in the future)
        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-past-booking-key")
            .send({
                slotId: slot.id,
            });

        const bookingId = bookingResponse.body.id;

        // 2. Attempt to reschedule to the past slot
        const rescheduleResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-past")
            .send({
                newSlotId: slotB.id,
            });

        expect(rescheduleResponse.status).toBe(400);
        expect(rescheduleResponse.body.error).toContain("Cannot reschedule to a slot in the past");
    });

    it("returns the replayed reschedule booking response when retried with the same key", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot,
        } = await createBookingFixture();

        // 1. Create slot B
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: new Date(slot.startTime.getTime() + 2 * 60 * 60 * 1000),
                endTime: new Date(slot.endTime.getTime() + 2 * 60 * 60 * 1000),
                status: "AVAILABLE",
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

        // 2. Book slot A
        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-replay-booking")
            .send({
                slotId: slot.id,
            });

        const bookingId = bookingResponse.body.id;

        const idempotencyKey = "reschedule-replay-key";

        // 3. First reschedule request
        const firstResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                newSlotId: slotB.id,
            });

        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.slot.id).toBe(slotB.id);

        // 4. Second reschedule request (retry)
        const secondResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                newSlotId: slotB.id,
            });

        expect(secondResponse.status).toBe(200);
        expect(secondResponse.headers["x-idempotent-replayed"]).toBe("true");
        expect(secondResponse.body.slot.id).toBe(slotB.id);
    });

    it("rejects reschedule retry if payload differs", async () => {
        const {
            organization,
            memberA,
            userA,
            mentor,
            slot,
        } = await createBookingFixture();

        // Create slot B & slot C
        const slotB = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: new Date(slot.startTime.getTime() + 2 * 60 * 60 * 1000),
                endTime: new Date(slot.endTime.getTime() + 2 * 60 * 60 * 1000),
                status: "AVAILABLE",
            },
        });

        const slotC = await prisma.mentorSlot.create({
            data: {
                organizationId: organization.id,
                mentorId: mentor.id,
                startTime: new Date(slot.startTime.getTime() + 4 * 60 * 60 * 1000),
                endTime: new Date(slot.endTime.getTime() + 4 * 60 * 60 * 1000),
                status: "AVAILABLE",
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

        const bookingResponse = await request(app)
            .post("/api/v1/bookings")
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", "reschedule-mismatch-booking")
            .send({
                slotId: slot.id,
            });

        const bookingId = bookingResponse.body.id;

        const idempotencyKey = "reschedule-mismatch-key";

        // First reschedule to slot B
        const firstResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                newSlotId: slotB.id,
            });

        expect(firstResponse.status).toBe(200);

        // Second reschedule retry but changing payload (targeting slot C)
        const secondResponse = await request(app)
            .post(`/api/v1/bookings/${bookingId}/reschedule`)
            .set("Cookie", [`token=${token}`])
            .set("Idempotency-Key", idempotencyKey)
            .send({
                newSlotId: slotC.id,
            });

        expect(secondResponse.status).toBe(400);
        expect(secondResponse.body.error).toContain("Idempotency key was already used with a different request payload");
    });
});


