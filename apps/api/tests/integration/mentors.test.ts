
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

        expect(response.body).toHaveLength(1);

        expect(response.body[0]).toMatchObject({
            membershipId: mentorA.id,
            userId: mentorA.userId,
        });

        expect(
            response.body.some(
                (mentor: { membershipId: string }) =>
                    mentor.membershipId === mentorB.id,
            ),
        ).toBe(false);
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
});