import { Router } from "express";
import { prisma } from "@chronus/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { validateTenantAccess } from "../middleware/tenant";
import { isValidUuid } from "../utils/validation";
import { redis } from "@chronus/redis";
import { logger } from "@chronus/logger";

const router = Router({ mergeParams: true });

// 24 hours in seconds
const CACHE_TTL_SECONDS = 24 * 60 * 60;

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
    const ALLOWED_LIMITS = [10, 20, 50, 100];
    const rawLimit = parseInt(req.query.limit as string, 10) || 10;
    const limit = ALLOWED_LIMITS.find((val) => rawLimit <= val) ?? 100;
    const skip = (page - 1) * limit;

    // 2. Fetch version number for the organization from Redis
    const versionKey = `org:${organizationId}:mentors:version`;
    let version: string | null = null;
    try {
      const rawVersion = await redis.get(versionKey);
      if (rawVersion) {
        version = rawVersion;
      } else {
        version = "1";
        // Initialize version to 1 if not present (unawaited fire-and-forget)
        redis.set(versionKey, version).catch((err) => {
          logger.warn(`Failed to initialize version for org ${organizationId}:`, { error: err });
        });
      }
    } catch (redisError) {
      logger.warn(`Failed to get version for org ${organizationId}:`, { error: redisError });
    }

    // 3. Check second cache level for paginated mentor list (only if version was successfully retrieved)
    const cacheKey = version ? `org:${organizationId}:mentors:v${version}:page:${page}:limit:${limit}` : null;
    if (cacheKey) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          logger.info(`Fetched cached mentors for key: ${cacheKey}`);
          res.status(200).json(JSON.parse(cachedData));
          return;
        }
      } catch (redisError) {
        logger.warn(`Failed to read cached mentors for key ${cacheKey}:`, { error: redisError });
      }
    }

    const whereClause = {
      organizationId,
      isMentor: true,
      id: { not: membershipId },
    };

    // 4. Query total count and paginated mentors in parallel from database
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

    // 5. Format output to return clean membership and user details
    const formattedMentors = mentors.map((mentor) => ({
      membershipId: mentor.id,
      userId: mentor.userId,
      email: mentor.user.email,
      name: mentor.user.name,
      timezone: mentor.timezone,
      createdAt: mentor.createdAt,
      updatedAt: mentor.updatedAt,
    }));

    const responsePayload = {
      data: formattedMentors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };

    // 6. Return response to user immediately
    res.status(200).json(responsePayload);

    // 7. Fire-and-forget: Populate Redis cache with 24 hours TTL in the background (if version was retrieved)
    if (cacheKey) {
      redis.set(cacheKey, JSON.stringify(responsePayload), "EX", CACHE_TTL_SECONDS).catch((redisError) => {
        logger.warn(`Failed to set cache for key ${cacheKey}:`, { error: redisError });
      });
    }
  } catch (error) {
    logger.error(`Failed to fetch mentors for org ${organizationId}:`, { error });
    res.status(500).json({ error: "Failed to fetch mentors." });
  }
});

// TTL for mentor availability slots (15 minutes in seconds)
const SLOTS_CACHE_TTL_SECONDS = 15 * 60;

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

    // 2. Parse and validate date range query parameters (range, or custom startDate & endDate)
    const now = new Date();
    let startRange = now;
    let endRange: Date;

    const hasCustomDates = Boolean(req.query.startDate || req.query.endDate);
    const range = typeof req.query.range === "string"
      ? req.query.range.toLowerCase()
      : (!hasCustomDates ? "30_days" : undefined);

    let slotsCacheKey: string | null = null;

    if (range) {
      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);

      switch (range) {
        case "today": {
          startRange = now;
          const endOfDay = new Date(todayStart);
          endOfDay.setUTCHours(23, 59, 59, 999);
          endRange = endOfDay;
          break;
        }
        case "next_7_days":
        case "7_days": {
          startRange = now;
          const in7Days = new Date(todayStart);
          in7Days.setUTCDate(in7Days.getUTCDate() + 7);
          in7Days.setUTCHours(23, 59, 59, 999);
          endRange = in7Days;
          break;
        }
        case "next_30_days":
        case "30_days": {
          startRange = now;
          const in30Days = new Date(todayStart);
          in30Days.setUTCDate(in30Days.getUTCDate() + 30);
          in30Days.setUTCHours(23, 59, 59, 999);
          endRange = in30Days;
          break;
        }
        case "this_month": {
          startRange = now;
          // End of current month in UTC
          const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
          endRange = endOfMonth;
          break;
        }
        default:
          res.status(400).json({
            error: "Invalid range format. Allowed values are: today, next_7_days, next_30_days, this_month.",
          });
          return;
      }

      // Format UTC date strings (YYYY-MM-DD) for start and end bounds in the cache key
      const startDateStr = todayStart.toISOString().split("T")[0];
      const endDateStr = endRange.toISOString().split("T")[0];

      // Check Redis cache for predefined range (only if version is retrieved successfully)
      const slotsVersionKey = `org:${organizationId}:mentor:${mentorId}:slots:version`;
      let slotsVersion: string | null = null;
      try {
        const rawVersion = await redis.get(slotsVersionKey);
        if (rawVersion) {
          slotsVersion = rawVersion;
        } else {
          slotsVersion = "1";
          // Initialize version to 1 if not present (unawaited fire-and-forget)
          redis.set(slotsVersionKey, slotsVersion).catch((err) => {
            logger.warn(`Failed to initialize slots version for mentor ${mentorId}:`, { error: err });
          });
        }
      } catch (redisError) {
        logger.warn(`Failed to get slots version for mentor ${mentorId}:`, { error: redisError });
      }

      // 4. Check second cache level for mentor slots (only if version was successfully retrieved)
      slotsCacheKey = slotsVersion ? `org:${organizationId}:mentor:${mentorId}:slots:v${slotsVersion}:start:${startDateStr}:end:${endDateStr}` : null;
      if (slotsCacheKey) {
        try {
          const cachedSlots = await redis.get(slotsCacheKey);
          if (cachedSlots) {
            logger.info(`Fetched cached slots for key: ${slotsCacheKey}`);
            res.status(200).json(JSON.parse(cachedSlots));
            return;
          }
        } catch (redisError) {
          logger.warn(`Failed to read cached slots for key ${slotsCacheKey}:`, { error: redisError });
        }
      }
    } else {
      // Explicit custom date range (startDate / endDate) -> bypass cache
      if (req.query.startDate) {
        const parsedStart = new Date(req.query.startDate as string);
        if (isNaN(parsedStart.getTime())) {
          res.status(400).json({ error: "Invalid startDate format. Expected a valid ISO 8601 date string." });
          return;
        }
        // Never expose past slots even if user requested an earlier startDate
        startRange = parsedStart > now ? parsedStart : now;
      }

      // Default upper cut: 30 days ahead from startRange if endDate is omitted
      const defaultEnd = new Date(startRange.getTime() + 30 * 24 * 60 * 60 * 1000);
      endRange = defaultEnd;

      if (req.query.endDate) {
        const parsedEnd = new Date(req.query.endDate as string);
        if (isNaN(parsedEnd.getTime())) {
          res.status(400).json({ error: "Invalid endDate format. Expected a valid ISO 8601 date string." });
          return;
        }
        endRange = parsedEnd;
      }

      if (startRange > endRange) {
        res.status(400).json({ error: "startDate must not be greater than endDate." });
        return;
      }
    }

    // 3. Fetch the mentor's availability slots within the date bounds
    const slots = await prisma.mentorSlot.findMany({
      where: {
        organizationId,
        mentorId,
        status: "AVAILABLE",
        startTime: {
          gte: startRange,
          lte: endRange,
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });

    // 4. Return response to client immediately
    res.status(200).json(slots);

    // 5. Fire-and-forget: Populate cache if predefined range was used
    if (slotsCacheKey) {
      redis.set(slotsCacheKey, JSON.stringify(slots), "EX", SLOTS_CACHE_TTL_SECONDS).catch((redisError) => {
        logger.warn(`Failed to set slots cache for key ${slotsCacheKey}:`, { error: redisError });
      });
    }
  } catch (error) {
    logger.error(`Failed to fetch slots for mentor ${mentorId} in org ${organizationId}:`, { error });
    res.status(500).json({ error: "Failed to fetch slots." });
  }
});

export default router;
