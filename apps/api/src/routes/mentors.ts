import { Router } from "express";
import { prisma } from "@chronus/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { validateTenantAccess } from "../middleware/tenant";
import { isValidUuid } from "../utils/validation";

const router = Router({ mergeParams: true });

/**
 * GET /mentors
 * Fetches all mentors belonging to the authenticated user's organization.
 */
router.get("/", requireAuth, validateTenantAccess, async (req: AuthenticatedRequest, res) => {
  // Extract tenant context from authenticated JWT payload
  const { organizationId } = req.user!;

  try {
    // 1. Query all mentors within the same organization
    const mentors = await prisma.organizationUser.findMany({
      where: {
        organizationId,
        isMentor: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 2. Format output to return clean membership and user details
    const formattedMentors = mentors.map((mentor) => ({
      membershipId: mentor.id,
      userId: mentor.userId,
      email: mentor.user.email,
      name: mentor.user.name,
      timezone: mentor.timezone,
      createdAt: mentor.createdAt,
      updatedAt: mentor.updatedAt,
    }));

    res.status(200).json(formattedMentors);
  } catch (error) {
    console.error(`[Mentors Route Error] Failed to fetch mentors for org ${organizationId}:`, error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * GET /mentors/:mentorId/slots
 * GET /:orgId/mentors/:mentorId/slots
 * Fetches all slots for a specific mentor within the authenticated user's organization.
 */
router.get("/:mentorId/slots", requireAuth, validateTenantAccess, async (req: AuthenticatedRequest, res) => {
  const { organizationId } = req.user!;
  const { mentorId } = req.params;

  // Validate mentorId UUID format
  if (!isValidUuid(mentorId)) {
    res.status(400).json({ error: "Invalid mentor ID format. Expected a valid UUID." });
    return;
  }

  try {
    // 1. Verify the requested mentor belongs to the same organization and is a mentor
    const mentor = await prisma.organizationUser.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: mentorId,
        },
      },
      select: {
        id: true,
        isMentor: true,
      },
    });

    if (!mentor || !mentor.isMentor) {
      res.status(404).json({ error: "Mentor not found in this organization." });
      return;
    }

    // 2. Fetch the mentor's availability slots
    const slots = await prisma.mentorSlot.findMany({
      where: {
        organizationId,
        mentorId,
        startTime: {
          gte: new Date(),
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });

    res.status(200).json(slots);
  } catch (error) {
    console.error(`[Slots Route Error] Failed to fetch slots for mentor ${mentorId} in org ${organizationId}:`, error);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
