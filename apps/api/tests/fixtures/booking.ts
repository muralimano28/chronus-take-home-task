import { prisma } from "@chronus/db";

export async function createBookingFixture() {
    // 1. Create a single Organization
    const organization = await prisma.organization.create({
        data: {
            name: "Booking Org",
        },
    });

    // 2. Create Users for Members and Mentor
    const userA = await prisma.user.create({
        data: {
            email: `member-a-${crypto.randomUUID()}@test.com`,
            name: "Member A",
        },
    });

    const userB = await prisma.user.create({
        data: {
            email: `member-b-${crypto.randomUUID()}@test.com`,
            name: "Member B",
        },
    });

    const mentorUser = await prisma.user.create({
        data: {
            email: `mentor-${crypto.randomUUID()}@test.com`,
            name: "Mentor User",
        },
    });

    // 3. Create Organization Users
    const memberA = await prisma.organizationUser.create({
        data: {
            organizationId: organization.id,
            userId: userA.id,
            timezone: "Asia/Kolkata",
            isMentor: false,
        },
    });

    const memberB = await prisma.organizationUser.create({
        data: {
            organizationId: organization.id,
            userId: userB.id,
            timezone: "Asia/Kolkata",
            isMentor: false,
        },
    });

    const mentor = await prisma.organizationUser.create({
        data: {
            organizationId: organization.id,
            userId: mentorUser.id,
            timezone: "Asia/Kolkata",
            isMentor: true,
        },
    });

    // 4. Create an AVAILABLE Mentor Slot
    const slot = await prisma.mentorSlot.create({
        data: {
            organizationId: organization.id,
            mentorId: mentor.id,
            startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
            endTime: new Date(Date.now() + 25 * 60 * 60 * 1000),
            status: "AVAILABLE",
        },
    });

    return {
        organization,
        memberA,
        memberB,
        userA,
        userB,
        mentor,
        mentorUser,
        slot,
    };
}
