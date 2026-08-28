import { Response, Router } from "express";
import { prisma } from "@chronus/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { isValidUuid } from "../utils/validation";

const router = Router();

/**
 * GET /bookings
 * Fetches all bookings (active and cancelled) for the authenticated user as a member.
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, membershipId } = req.user!;

  try {
    // 1. Query bookings where the authenticated user is the booking member
    const bookings = await prisma.booking.findMany({
      where: {
        organizationId,
        memberId: membershipId,
      },
      include: {
        slot: {
          include: {
            mentor: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 2. Format bookings output for clean consumption
    const formattedBookings = bookings.map((b) => ({
      id: b.id,
      status: b.status,
      idempotencyKey: b.idempotencyKey,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      slot: {
        id: b.slot.id,
        startTime: b.slot.startTime,
        endTime: b.slot.endTime,
        mentor: {
          membershipId: b.slot.mentor.id,
          userId: b.slot.mentor.userId,
          name: b.slot.mentor.user.name,
          email: b.slot.mentor.user.email,
          timezone: b.slot.mentor.timezone,
        },
      },
    }));

    res.status(200).json(formattedBookings);
  } catch (error) {
    console.error(`[Bookings Route Error] Failed to fetch bookings for member ${membershipId} in org ${organizationId}:`, error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * POST /bookings
 * Creates a new booking for a specific mentor slot.
 * Enforces idempotency via the idempotencyKey, and handles concurrency safety via transactions.
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, membershipId } = req.user!;
  const { slotId } = req.body;
  const idempotencyKey = req.get("Idempotency-Key");

  // 1. Validate inputs
  if (!isValidUuid(slotId)) {
    res.status(400).json({ error: "Invalid slotId format. Expected a valid UUID." });
    return;
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    res.status(400).json({ error: "Missing or invalid idempotencyKey. Expected a non-empty string." });
    return;
  }

  const getReplayedBooking = () => prisma.booking.findUnique({
    where: {
      organizationId_memberId_idempotencyKey: {
        organizationId,
        memberId: membershipId,
        idempotencyKey,
      },
    },
    include: {
      member: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      slot: {
        include: {
          mentor: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  });

  try {
    // 2. Check for existing booking (Idempotency Check)
    const existingBooking = await getReplayedBooking();

    if (existingBooking) {
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(formatBookingResponse(existingBooking));
      return;
    }

    // 3. Fetch the slot to verify existence and business rules
    const slot = await prisma.mentorSlot.findUnique({
      where: {
        organizationId_id: {
          id: slotId,
          organizationId,
        },
      },
    });

    if (!slot) {
      res.status(404).json({ error: "Slot not found in your organization." });
      return;
    }

    if (slot.status !== "AVAILABLE") {
      res.status(409).json({ error: "Slot is no longer available or has already been booked." });
      return;
    }

    // Business Rule: Mentors cannot book their own slots
    if (slot.mentorId === membershipId) {
      res.status(400).json({ error: "Access denied. You cannot book your own mentor slot." });
      return;
    }

    // Business Rule: A member cannot book overlapping slots
    const overlappingBooking = await prisma.booking.findFirst({
      where: {
        organizationId,
        memberId: membershipId,
        status: "ACTIVE",
        slot: {
          startTime: { lt: slot.endTime },
          endTime: { gt: slot.startTime },
        },
      },
    });

    if (overlappingBooking) {
      res.status(400).json({ error: "You already have a booking that overlaps with this slot's time." });
      return;
    }

    // 4. Concurrency-safe Slot Reservation and Booking Creation
    const newBooking = await prisma.$transaction(async (tx) => {
      // Atomically update the slot status to BOOKED
      // (This will fail if another transaction changed the status to BOOKED concurrently)
      // We are performing optimistic locking below
      await tx.mentorSlot.update({
        where: {
          id: slotId,
          organizationId,
          status: "AVAILABLE",
        },
        data: {
          status: "BOOKED",
        },
      });

      // Create the booking record
      const booking = await tx.booking.create({
        data: {
          organizationId,
          memberId: membershipId,
          slotId,
          status: "ACTIVE",
          idempotencyKey,
        },
        include: {
          member: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
          slot: {
            include: {
              mentor: {
                include: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      return booking;
    });

    res.status(201).json(formatBookingResponse(newBooking));
  } catch (error: any) {
    if (error && typeof error === "object") {
      // P2002: Unique constraint failed, P2025: Record to update not found (status was not AVAILABLE)
      if (error.code === "P2002" || error.code === "P2025") {
        try {
          const replayedBooking = await getReplayedBooking();
          if (replayedBooking) {
            res.setHeader("x-idempotent-replayed", "true");
            res.status(200).json(formatBookingResponse(replayedBooking));
            return;
          }
        } catch (fetchError) {
          console.error("[Bookings Route Error] Failed to fetch replayed booking:", fetchError);
        }

        // If no replayed booking exists, it's a conflict
        res.status(409).json({ error: "Slot is no longer available or has already been booked." });
        return;
      }
    }

    console.error(`[Bookings Route Error] Failed to create booking for member ${membershipId} in org ${organizationId}:`, error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Helper function to format booking response uniformly
function formatBookingResponse(b: any) {
  return {
    id: b.id,
    status: b.status,
    idempotencyKey: b.idempotencyKey,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    member: {
      membershipId: b.member.id,
      userId: b.member.userId,
      name: b.member.user?.name,
      email: b.member.user?.email,
    },
    slot: {
      id: b.slot.id,
      startTime: b.slot.startTime,
      endTime: b.slot.endTime,
      mentor: {
        membershipId: b.slot.mentor.id,
        userId: b.slot.mentor.userId,
        name: b.slot.mentor.user.name,
        email: b.slot.mentor.user.email,
        timezone: b.slot.mentor.timezone,
      },
    },
  };
}

export default router;
