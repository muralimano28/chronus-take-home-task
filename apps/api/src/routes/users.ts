import { Router } from "express";
import { prisma } from "@chronus/db";

const router = Router();

/**
 * GET /users
 * Fetches all organization users (members and mentors) across all organizations.
 * Useful for switching identity (memberships) on the frontend.
 */
router.get("/", async (req, res) => {
  try {
    const orgUsers = await prisma.organizationUser.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedUsers = orgUsers.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      name: membership.user.name,
      timezone: membership.timezone,
      isMentor: membership.isMentor,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
      },
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    }));

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("[API Error] Failed to fetch users:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
