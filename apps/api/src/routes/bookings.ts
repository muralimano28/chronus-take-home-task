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
      if (existingBooking.slotId !== slotId) {
        res.status(400).json({ error: "Idempotency key was already used with a different slotId." });
        return;
      }
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

    // Business Rule: Cannot book a slot in the past
    if (slot.startTime < new Date()) {
      res.status(400).json({ error: "Cannot book a slot in the past." });
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

/**
 * POST /bookings/:bookingId/cancel
 * Cancels a booking, marks the associated slot as AVAILABLE, inside a transaction.
 */
router.post("/:bookingId/cancel", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, membershipId } = req.user!;
  const { bookingId } = req.params;

  if (!isValidUuid(bookingId)) {
    res.status(400).json({ error: "Invalid bookingId format. Expected a valid UUID." });
    return;
  }

  try {
    // 1. Fetch booking to check ownership, organization, status, and fetch slotId
    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
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

    // Enforce tenant isolation and ownership check:
    // User must belong to the same organization and must be the member who booked it.
    if (!booking || booking.organizationId !== organizationId || booking.memberId !== membershipId) {
      res.status(404).json({ error: "Booking not found." });
      return;
    }

    // 2. If already cancelled, return 200 OK (idempotent no-op)
    if (booking.status === "CANCELLED") {
      res.status(200).json(formatBookingResponse(booking));
      return;
    }

    // Business Rule: Cannot cancel a booking for a slot that has already started/is in the past
    if (booking.slot.startTime < new Date()) {
      res.status(400).json({ error: "Cannot cancel a booking for a slot in the past." });
      return;
    }

    // 3. Process cancellation within a transaction
    const updatedBooking = await prisma.$transaction(async (tx) => {
      // Free up the slot
      await tx.mentorSlot.update({
        where: {
          organizationId_id: {
            organizationId,
            id: booking.slotId,
          },
        },
        data: {
          status: "AVAILABLE",
        },
      });

      // Mark the booking as cancelled
      const cancelledBooking = await tx.booking.update({
        where: {
          id: bookingId,
        },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
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

      return cancelledBooking;
    });

    res.status(200).json(formatBookingResponse(updatedBooking));
  } catch (error) {
    console.error(`[Bookings Route Error] Failed to cancel booking ${bookingId} for member ${membershipId} in org ${organizationId}:`, error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * POST /bookings/:bookingId/reschedule
 * Reschedules an active booking to another available slot within the same organization.
 */
router.post("/:bookingId/reschedule", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { organizationId, membershipId } = req.user!;
  const { bookingId } = req.params;
  const { newSlotId } = req.body;

  if (!isValidUuid(bookingId) || !isValidUuid(newSlotId)) {
    res.status(400).json({ error: "Invalid bookingId or newSlotId format. Expected valid UUIDs." });
    return;
  }

  try {
    // 1. Fetch current booking
    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
    });

    // Enforce tenant isolation and ownership check:
    // User must belong to the same organization and must be the member who booked it.
    if (!booking || booking.organizationId !== organizationId || booking.memberId !== membershipId) {
      res.status(404).json({ error: "Booking not found." });
      return;
    }

    if (booking.status !== "ACTIVE") {
      res.status(400).json({ error: "Only active bookings can be rescheduled." });
      return;
    }

    // If new slot is the same as old slot, it's a no-op
    if (booking.slotId === newSlotId) {
      // Re-fetch with full relations to return formatted response
      const fullBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          member: {
            include: {
              user: {
                select: { name: true, email: true },
              },
            },
          },
          slot: {
            include: {
              mentor: {
                include: {
                  user: {
                    select: { name: true, email: true },
                  },
                },
              },
            },
          },
        },
      });
      res.status(200).json(formatBookingResponse(fullBooking));
      return;
    }

    // 2. Fetch new slot
    const newSlot = await prisma.mentorSlot.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: newSlotId,
        },
      },
    });

    if (!newSlot) {
      res.status(400).json({ error: "New slot not found in your organization." });
      return;
    }

    if (newSlot.status !== "AVAILABLE") {
      res.status(409).json({ error: "New slot is already booked." });
      return;
    }

    // Business Rule: Cannot reschedule to a slot in the past
    if (newSlot.startTime < new Date()) {
      res.status(400).json({ error: "Cannot reschedule to a slot in the past." });
      return;
    }

    // Business Rule: Mentors cannot book/reschedule to their own slots
    if (newSlot.mentorId === membershipId) {
      res.status(400).json({ error: "Access denied. You cannot book your own mentor slot." });
      return;
    }

    // Business Rule: A member cannot book overlapping slots (excluding the booking currently being rescheduled)
    const overlappingBooking = await prisma.booking.findFirst({
      where: {
        organizationId,
        memberId: membershipId,
        status: "ACTIVE",
        id: { not: bookingId }, // Exclude the current booking being moved
        slot: {
          startTime: { lt: newSlot.endTime },
          endTime: { gt: newSlot.startTime },
        },
      },
    });

    if (overlappingBooking) {
      res.status(400).json({ error: "You already have a booking that overlaps with the new slot's time." });
      return;
    }

    // 3. Process reschedule inside a transaction
    const updatedBooking = await prisma.$transaction(async (tx) => {
      // Free up old slot
      await tx.mentorSlot.update({
        where: {
          organizationId_id: {
            organizationId,
            id: booking.slotId,
          },
        },
        data: {
          status: "AVAILABLE",
        },
      });

      // Reserve new slot (optimistic locking checks status: AVAILABLE)
      await tx.mentorSlot.update({
        where: {
          id: newSlotId,
          organizationId,
          status: "AVAILABLE",
        },
        data: {
          status: "BOOKED",
        },
      });

      // Update slot ID on the existing booking
      const bookingRecord = await tx.booking.update({
        where: {
          id: bookingId,
        },
        data: {
          slotId: newSlotId,
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

      return bookingRecord;
    });

    res.status(200).json(formatBookingResponse(updatedBooking));
  } catch (error: any) {
    if (error && typeof error === "object") {
      // Record not found during newSlot status AVAILABLE condition check
      if (error.code === "P2025" || error.code === "P2002") {
        res.status(409).json({ error: "New slot is no longer available." });
        return;
      }
    }
    console.error(`[Bookings Route Error] Failed to reschedule booking ${bookingId} to slot ${newSlotId} for member ${membershipId} in org ${organizationId}:`, error);
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
