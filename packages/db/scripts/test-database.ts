import "dotenv/config";
import prisma from "../src/client";

async function testDatabase() {
  console.log("🔍 Testing Prisma Postgres connection & schema...\n");

  const timestamp = Date.now();
  const testEmail = `test-${timestamp}@example.com`;
  const memberEmail = `member-${timestamp}@example.com`;

  let user1Id: string | undefined;
  let user2Id: string | undefined;
  let orgId: string | undefined;
  let orgUser1Id: string | undefined;
  let orgUser2Id: string | undefined;
  let slotId: string | undefined;
  let bookingId: string | undefined;

  try {
    console.log("✅ Connected to database!");

    // 1. Create Users
    console.log("\n📝 Creating test users...");
    const mentor = await prisma.user.create({
      data: {
        email: testEmail,
        name: "Test Mentor User",
      },
    });
    user1Id = mentor.id;
    console.log("✅ Created mentor user:", mentor.email);

    const member = await prisma.user.create({
      data: {
        email: memberEmail,
        name: "Test Member User",
      },
    });
    user2Id = member.id;
    console.log("✅ Created member user:", member.email);

    // 2. Create Organization
    console.log("\n🏢 Creating a test organization...");
    const org = await prisma.organization.create({
      data: {
        name: "Test Org Inc.",
      },
    });
    orgId = org.id;
    console.log("✅ Created organization:", org.name);

    // 3. Create memberships (OrganizationUser)
    console.log("\n👥 Creating organization memberships...");
    const orgMentor = await prisma.organizationUser.create({
      data: {
        organizationId: org.id,
        userId: mentor.id,
        timezone: "America/New_York",
        isMentor: true,
      },
    });
    orgUser1Id = orgMentor.id;
    console.log("✅ Created mentor membership");

    const orgMember = await prisma.organizationUser.create({
      data: {
        organizationId: org.id,
        userId: member.id,
        timezone: "Asia/Kolkata",
        isMentor: false,
      },
    });
    orgUser2Id = orgMember.id;
    console.log("✅ Created member membership");

    // 4. Create a Mentor Slot
    console.log("\n📅 Creating a mentor slot...");
    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h later
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30m slot
    const slot = await prisma.mentorSlot.create({
      data: {
        organizationId: org.id,
        mentorId: orgMentor.id,
        startTime,
        endTime,
      },
    });
    slotId = slot.id;
    console.log("✅ Created mentor slot:", slot.id);

    // 5. Create a Booking
    console.log("\n🎟️ Creating a booking for the slot...");
    const booking = await prisma.booking.create({
      data: {
        organizationId: org.id,
        memberID: orgMember.id,
        slotId: slot.id,
        idempotencyKey: `key-${timestamp}`,
      },
    });
    bookingId = booking.id;
    console.log("✅ Created booking:", booking.id);

    console.log("\n🎉 All schema tests passed! Your database and relations are working perfectly.\n");
  } catch (error) {
    console.error("❌ Test failed with error:", error);
    process.exit(1);
  } finally {
    // Cleanup created records in reverse dependency order
    console.log("🧹 Cleaning up test records...");
    try {
      if (bookingId) await prisma.booking.delete({ where: { id: bookingId } });
      if (slotId) await prisma.mentorSlot.delete({ where: { id: slotId } });
      if (orgUser1Id) await prisma.organizationUser.delete({ where: { id: orgUser1Id } });
      if (orgUser2Id) await prisma.organizationUser.delete({ where: { id: orgUser2Id } });
      if (orgId) await prisma.organization.delete({ where: { id: orgId } });
      if (user1Id) await prisma.user.delete({ where: { id: user1Id } });
      if (user2Id) await prisma.user.delete({ where: { id: user2Id } });
      console.log("✅ Cleanup complete.");
    } catch (cleanupError) {
      console.error("⚠️ Cleanup encountered an error:", cleanupError);
    }
    await prisma.$disconnect();
  }
}

testDatabase();
