import { prisma } from "@chronus/db";

export async function createTenantFixture() {
    const organizationA = await prisma.organization.create({
        data: {
            name: "Tenant A",
        },
    });

    const organizationB = await prisma.organization.create({
        data: {
            name: "Tenant B",
        },
    });

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

    const mentorUserA = await prisma.user.create({
        data: {
            email: `mentor-a-${crypto.randomUUID()}@test.com`,
            name: "Mentor A",
        },
    });

    const mentorUserB = await prisma.user.create({
        data: {
            email: `mentor-b-${crypto.randomUUID()}@test.com`,
            name: "Mentor B",
        },
    });

    const memberA = await prisma.organizationUser.create({
        data: {
            organizationId: organizationA.id,
            userId: userA.id,
            timezone: "Asia/Kolkata",
            isMentor: false,
        },
    });

    const memberB = await prisma.organizationUser.create({
        data: {
            organizationId: organizationB.id,
            userId: userB.id,
            timezone: "America/New_York",
            isMentor: false,
        },
    });

    const mentorA = await prisma.organizationUser.create({
        data: {
            organizationId: organizationA.id,
            userId: mentorUserA.id,
            timezone: "America/New_York",
            isMentor: true,
        },
    });

    const mentorB = await prisma.organizationUser.create({
        data: {
            organizationId: organizationB.id,
            userId: mentorUserB.id,
            timezone: "Europe/London",
            isMentor: true,
        },
    });

    return {
        organizationA,
        organizationB,

        memberA,
        memberB,

        mentorA,
        mentorB,

        userA,
        userB,

        mentorUserA,
        mentorUserB,
    };
}