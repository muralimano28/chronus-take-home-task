import prisma from "../src/client";

async function main() {
    console.log("🌱 Starting database seed...");

    // ---------------------------------------------------------------------------
    // Clean existing data
    // ---------------------------------------------------------------------------
    // Delete in dependency order.
    await prisma.booking.deleteMany();
    await prisma.mentorSlot.deleteMany();
    await prisma.organizationUser.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    // ---------------------------------------------------------------------------
    // Organizations
    // ---------------------------------------------------------------------------
    const acme = await prisma.organization.create({
        data: {
            name: "Acme Corporation",
        },
    });

    const globex = await prisma.organization.create({
        data: {
            name: "Globex Corporation",
        },
    });

    // ---------------------------------------------------------------------------
    // Users
    // ---------------------------------------------------------------------------
    const users = await Promise.all([
        prisma.user.create({
            data: {
                email: "john.india@example.com",
                name: "John India",
            },
        }),

        prisma.user.create({
            data: {
                email: "alice.us@example.com",
                name: "Alice America",
            },
        }),

        prisma.user.create({
            data: {
                email: "bob.uk@example.com",
                name: "Bob Britain",
            },
        }),

        prisma.user.create({
            data: {
                email: "carol.singapore@example.com",
                name: "Carol Singapore",
            },
        }),

        prisma.user.create({
            data: {
                email: "david.india@example.com",
                name: "David India",
            },
        }),
    ]);

    const [
        john,
        alice,
        bob,
        carol,
        david,
    ] = users;

    // ---------------------------------------------------------------------------
    // Organization memberships
    // ---------------------------------------------------------------------------

    // ACME
    const acmeJohn = await prisma.organizationUser.create({
        data: {
            organizationId: acme.id,
            userId: john.id,
            timezone: "Asia/Kolkata",
            isMentor: false,
        },
    });

    const acmeAlice = await prisma.organizationUser.create({
        data: {
            organizationId: acme.id,
            userId: alice.id,
            timezone: "America/New_York",
            isMentor: true,
        },
    });

    const acmeBob = await prisma.organizationUser.create({
        data: {
            organizationId: acme.id,
            userId: bob.id,
            timezone: "Europe/London",
            isMentor: true,
        },
    });

    // GLOBEX
    const globexCarol = await prisma.organizationUser.create({
        data: {
            organizationId: globex.id,
            userId: carol.id,
            timezone: "Asia/Singapore",
            isMentor: true,
        },
    });

    const globexDavid = await prisma.organizationUser.create({
        data: {
            organizationId: globex.id,
            userId: david.id,
            timezone: "Asia/Kolkata",
            isMentor: false,
        },
    });

    // ---------------------------------------------------------------------------
    // Helper for creating slots
    // ---------------------------------------------------------------------------
    function addDays(date: Date, days: number) {
        const result = new Date(date);
        result.setUTCDate(result.getUTCDate() + days);
        return result;
    }

    function utcAt(
        base: Date,
        daysFromNow: number,
        hour: number,
        minute = 0,
    ) {
        const date = addDays(base, daysFromNow);

        date.setUTCHours(hour, minute, 0, 0);

        return date;
    }

    const now = new Date();

    /*
     * IMPORTANT:
     *
     * We store slot times as UTC.
     *
     * The comments below describe the intended local time for the mentor.
     * Your frontend/API should convert these timestamps using the user's
     * timezone.
     */

    // ---------------------------------------------------------------------------
    // ACME - Alice (New York mentor)
    // ---------------------------------------------------------------------------

    const acmeAliceSlots = [
        {
            startTime: utcAt(now, 1, 14, 0), // 10:00 AM New York
            endTime: utcAt(now, 1, 14, 30),
        },
        {
            startTime: utcAt(now, 1, 15, 0), // 11:00 AM New York
            endTime: utcAt(now, 1, 15, 30),
        },
        {
            startTime: utcAt(now, 1, 16, 0), // 12:00 PM New York
            endTime: utcAt(now, 1, 16, 30),
        },
        {
            startTime: utcAt(now, 2, 14, 0),
            endTime: utcAt(now, 2, 14, 30),
        },
    ];

    // ---------------------------------------------------------------------------
    // ACME - Bob (London mentor)
    // ---------------------------------------------------------------------------

    const acmeBobSlots = [
        {
            startTime: utcAt(now, 1, 9, 0), // 10:00 AM London
            endTime: utcAt(now, 1, 9, 30),
        },
        {
            startTime: utcAt(now, 1, 10, 0), // 11:00 AM London
            endTime: utcAt(now, 1, 10, 30),
        },
        {
            startTime: utcAt(now, 1, 11, 0), // 12:00 PM London
            endTime: utcAt(now, 1, 11, 30),
        },
        {
            startTime: utcAt(now, 2, 9, 0),
            endTime: utcAt(now, 2, 9, 30),
        },
    ];

    // ---------------------------------------------------------------------------
    // GLOBEX - Carol (Singapore mentor)
    // ---------------------------------------------------------------------------

    const globexCarolSlots = [
        {
            startTime: utcAt(now, 1, 2, 0), // 10:00 AM Singapore
            endTime: utcAt(now, 1, 2, 30),
        },
        {
            startTime: utcAt(now, 1, 3, 0), // 11:00 AM Singapore
            endTime: utcAt(now, 1, 3, 30),
        },
        {
            startTime: utcAt(now, 1, 4, 0), // 12:00 PM Singapore
            endTime: utcAt(now, 1, 4, 30),
        },
        {
            startTime: utcAt(now, 2, 2, 0),
            endTime: utcAt(now, 2, 2, 30),
        },
    ];

    // ---------------------------------------------------------------------------
    // Create slots
    // ---------------------------------------------------------------------------

    await prisma.mentorSlot.createMany({
        data: [
            ...acmeAliceSlots.map((slot) => ({
                organizationId: acme.id,
                mentorId: acmeAlice.id,
                ...slot,
            })),

            ...acmeBobSlots.map((slot) => ({
                organizationId: acme.id,
                mentorId: acmeBob.id,
                ...slot,
            })),

            ...globexCarolSlots.map((slot) => ({
                organizationId: globex.id,
                mentorId: globexCarol.id,
                ...slot,
            })),
        ],
    });

    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------

    const organizationCount = await prisma.organization.count();
    const userCount = await prisma.user.count();
    const membershipCount = await prisma.organizationUser.count();
    const mentorSlotCount = await prisma.mentorSlot.count();

    console.log("\n✅ Seed completed!");
    console.log(`Organizations:       ${organizationCount}`);
    console.log(`Users:               ${userCount}`);
    console.log(`Organization users:  ${membershipCount}`);
    console.log(`Mentor slots:        ${mentorSlotCount}`);

    console.log("\nTest users:");
    console.log(`ACME member:  ${john.email}`);
    console.log(`ACME mentor:  ${alice.email}`);
    console.log(`ACME mentor:  ${bob.email}`);
    console.log(`Globex mentor:${carol.email}`);
    console.log(`Globex member:${david.email}`);
}

main()
    .catch((error) => {
        console.error("❌ Seed failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });