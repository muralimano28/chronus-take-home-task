import { prisma } from "@chronus/db";

export async function cleanDatabase() {
    await prisma.outboxEvent.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.mentorSlot.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
}