
import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app";
import { createTenantFixture } from "../fixtures/tenant";
import { createTestToken } from "../helpers/auth";
import { prisma } from "@chronus/db";

describe("Mentor tenant isolation", () => {
    it("does not expose mentors from another organization", async () => {
        const {
            organizationA,
            organizationB,
            userA,
            memberA,
            mentorA,
            mentorB,
        } = await createTenantFixture();

        expect(organizationA.id).not.toBe(organizationB.id);
        expect(mentorA.organizationId).toBe(organizationA.id);
        expect(mentorB.organizationId).toBe(organizationB.id);

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

        const response = await request(app)
            .get("/api/v1/mentors")
            .set("Cookie", [`token=${token}`]);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("pagination");
        expect(response.body.pagination).toMatchObject({
            total: 1,
            page: 1,
            limit: 10,
            totalPages: 1,
        });

        expect(response.body.data).toHaveLength(1);

        expect(response.body.data[0]).toMatchObject({
            membershipId: mentorA.id,
            userId: mentorA.userId,
        });

        expect(
            response.body.data.some(
                (mentor: { membershipId: string }) =>
                    mentor.membershipId === mentorB.id,
            ),
        ).toBe(false);
    });

    it("paginates mentors correctly with page and limit parameters", async () => {
        const {
            organizationA,
            memberA,
            userA,
        } = await createTenantFixture();

        // Create 14 additional mentors in organizationA (total 15 mentors: mentorA + 14)
        for (let i = 1; i <= 14; i++) {
            const user = await prisma.user.create({
                data: {
                    email: `extra-mentor-${i}-${Date.now()}@example.com`,
                    name: `Extra Mentor ${i}`,
                },
            });
            await prisma.organizationUser.create({
                data: {
                    organizationId: organizationA.id,
                    userId: user.id,
                    isMentor: true,
                    timezone: "UTC",
                },
            });
        }

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

        // 1. Fetch page 1 with limit 10 (total should be 15 mentors: mentorA + 14 extra)
        const page1Response = await request(app)
            .get("/api/v1/mentors?page=1&limit=10")
            .set("Cookie", [`token=${token}`]);

        expect(page1Response.status).toBe(200);
        expect(page1Response.body.pagination).toEqual({
            total: 15,
            page: 1,
            limit: 10,
            totalPages: 2,
        });
        expect(page1Response.body.data).toHaveLength(10);

        // 2. Fetch page 2 with limit 10
        const page2Response = await request(app)
            .get("/api/v1/mentors?page=2&limit=10")
            .set("Cookie", [`token=${token}`]);

        expect(page2Response.status).toBe(200);
        expect(page2Response.body.pagination).toEqual({
            total: 15,
            page: 2,
            limit: 10,
            totalPages: 2,
        });
        expect(page2Response.body.data).toHaveLength(5);

        // Ensure page 1 and page 2 returned distinct sets
        const page1Ids = page1Response.body.data.map((m: { membershipId: string }) => m.membershipId);
        const page2Ids = page2Response.body.data.map((m: { membershipId: string }) => m.membershipId);
        expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it("rejects a token whose membership does not belong to the claimed organization", async () => {
        const {
            organizationA,
            organizationB,
            memberA,
            userA,
        } = await createTenantFixture();

        const token = createTestToken({
            membershipId: memberA.id,

            userId: userA.id,

            // 🔥 Deliberately claim another organization
            organizationId: organizationB.id,

            isMentor: false,
            timezone: userA ? "Asia/Kolkata" : "UTC",
            name: userA.name,
            email: userA.email,
            organizationName: organizationB.name,
        });

        const response = await request(app)
            .get("/api/v1/mentors")
            .set("Cookie", [`token=${token}`]);

        expect(response.status).toBe(403);

        expect(response.body).toEqual({
            error:
                "Access denied. Your membership is invalid or has been deactivated.",
        });
    });

    it("does not return expired/past slots when retrieving slots for a mentor", async () => {
        const {
            organizationA,
            memberA,
            mentorA,
            userA,
        } = await createTenantFixture();

        // 1. Create a past slot (yesterday)
        const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000);
        const pastSlot = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: pastStart,
                endTime: pastEnd,
                status: "AVAILABLE",
            },
        });

        // 2. Create a future slot (tomorrow)
        const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);
        const futureSlot = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: futureStart,
                endTime: futureEnd,
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

        const response = await request(app)
            .get(`/api/v1/mentors/${mentorA.id}/slots`)
            .set("Cookie", [`token=${token}`]);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);

        const slotIds = response.body.map((s: { id: string }) => s.id);
        expect(slotIds).not.toContain(pastSlot.id);
        expect(slotIds).toContain(futureSlot.id);
    });

    it("filters mentor slots correctly with startDate and endDate query parameters", async () => {
        const {
            organizationA,
            memberA,
            mentorA,
            userA,
        } = await createTenantFixture();

        const now = Date.now();
        // Slot 1: in 2 days
        const slot1Start = new Date(now + 2 * 24 * 60 * 60 * 1000);
        const slot1End = new Date(slot1Start.getTime() + 60 * 60 * 1000);
        const slot1 = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: slot1Start,
                endTime: slot1End,
                status: "AVAILABLE",
            },
        });

        // Slot 2: in 5 days
        const slot2Start = new Date(now + 5 * 24 * 60 * 60 * 1000);
        const slot2End = new Date(slot2Start.getTime() + 60 * 60 * 1000);
        const slot2 = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: slot2Start,
                endTime: slot2End,
                status: "AVAILABLE",
            },
        });

        // Slot 3: in 10 days
        const slot3Start = new Date(now + 10 * 24 * 60 * 60 * 1000);
        const slot3End = new Date(slot3Start.getTime() + 60 * 60 * 1000);
        const slot3 = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: slot3Start,
                endTime: slot3End,
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

        // Slot 4: in 35 days (should be excluded by default 30-day window)
        const slot4Start = new Date(now + 35 * 24 * 60 * 60 * 1000);
        const slot4End = new Date(slot4Start.getTime() + 60 * 60 * 1000);
        const slot4 = await prisma.mentorSlot.create({
            data: {
                organizationId: organizationA.id,
                mentorId: mentorA.id,
                startTime: slot4Start,
                endTime: slot4End,
                status: "AVAILABLE",
            },
        });

        // Query with default window (no startDate, no endDate): should return slot 1, 2, 3 but NOT slot 4
        const defaultWindowRes = await request(app)
            .get(`/api/v1/mentors/${mentorA.id}/slots`)
            .set("Cookie", [`token=${token}`]);

        expect(defaultWindowRes.status).toBe(200);
        const returnedIds = defaultWindowRes.body.map((s: { id: string }) => s.id);
        expect(returnedIds).toContain(slot1.id);
        expect(returnedIds).toContain(slot2.id);
        expect(returnedIds).toContain(slot3.id);
        expect(returnedIds).not.toContain(slot4.id);

        // Query date range between 4 days and 6 days from now (should only match Slot 2)
        const filterStart = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
        const filterEnd = new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString();

        const response = await request(app)
            .get(`/api/v1/mentors/${mentorA.id}/slots?startDate=${filterStart}&endDate=${filterEnd}`)
            .set("Cookie", [`token=${token}`]);

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].id).toBe(slot2.id);

        // Invalid date format test
        const invalidRes = await request(app)
            .get(`/api/v1/mentors/${mentorA.id}/slots?startDate=not-a-date`)
            .set("Cookie", [`token=${token}`]);
        expect(invalidRes.status).toBe(400);

        // startDate > endDate test
        const invertedRes = await request(app)
            .get(`/api/v1/mentors/${mentorA.id}/slots?startDate=${filterEnd}&endDate=${filterStart}`)
            .set("Cookie", [`token=${token}`]);
        expect(invertedRes.status).toBe(400);
    });

    it("prevents privilege escalation by trusting DB state over stale JWT isMentor claims", async () => {
        const {
            organizationA,
            memberA,
            userA,
        } = await createTenantFixture();

        // 1. Create a token with isMentor: true forged or stale in the JWT, but memberA in DB is isMentor: false
        const forgedMentorToken = createTestToken({
            membershipId: memberA.id,
            userId: userA.id,
            organizationId: organizationA.id,
            isMentor: true, // ⚠️ Stale / forged claim!
            timezone: memberA.timezone,
            name: userA.name,
            email: userA.email,
            organizationName: organizationA.name,
        });

        // 2. Attempt to access mentor-only endpoint GET /mentors/me/slots
        const response = await request(app)
            .get("/api/v1/mentors/me/slots")
            .set("Cookie", [`token=${forgedMentorToken}`]);

        // 3. Must be rejected because the database record has isMentor: false
        expect(response.status).toBe(403);
        expect(response.body.error).toBe("Only mentors can access this endpoint.");
    });
});