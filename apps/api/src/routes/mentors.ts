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
  const { organizationId, membershipId } = req.user!;

  try {
    // 1. Parse pagination query parameters with defaults and bounds
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const skip = (page - 1) * limit;

    const whereClause = {
      organizationId,
      isMentor: true,
      id: { not: membershipId },
    };

    // 2. Query total count and paginated mentors in parallel
    const [total, mentors] = await Promise.all([
      prisma.organizationUser.count({
        where: whereClause,
      }),
      prisma.organizationUser.findMany({
        where: whereClause,
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
        skip,
        take: limit,
      }),
    ]);

    // 3. Format output to return clean membership and user details
    const formattedMentors = mentors.map((mentor) => ({
      membershipId: mentor.id,
      userId: mentor.userId,
      email: mentor.user.email,
      name: mentor.user.name,
      timezone: mentor.timezone,
      createdAt: mentor.createdAt,
      updatedAt: mentor.updatedAt,
    }));

    res.status(200).json({
      data: formattedMentors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
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

    // 2. Parse and validate date range query parameters (startDate, endDate)
    const now = new Date();
    let minStartTime = now;

    if (req.query.startDate) {
      const parsedStart = new Date(req.query.startDate as string);
      if (isNaN(parsedStart.getTime())) {
        res.status(400).json({ error: "Invalid startDate format. Expected a valid ISO 8601 date string." });
        return;
      }
      // Never expose past slots even if user requested an earlier startDate
      minStartTime = parsedStart > now ? parsedStart : now;
    }

    // Default upper cut: 30 days ahead from minStartTime if endDate is omitted
    const defaultEnd = new Date(minStartTime.getTime() + 30 * 24 * 60 * 60 * 1000);
    let maxStartTime: Date = defaultEnd;

    if (req.query.endDate) {
      const parsedEnd = new Date(req.query.endDate as string);
      if (isNaN(parsedEnd.getTime())) {
        res.status(400).json({ error: "Invalid endDate format. Expected a valid ISO 8601 date string." });
        return;
      }
      maxStartTime = parsedEnd;
    }

    if (minStartTime > maxStartTime) {
      res.status(400).json({ error: "startDate must not be greater than endDate." });
      return;
    }

    // 3. Fetch the mentor's availability slots within the date bounds
    const slots = await prisma.mentorSlot.findMany({
      where: {
        organizationId,
        mentorId,
        status: "AVAILABLE",
        startTime: {
          gte: minStartTime,
          lte: maxStartTime,
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
