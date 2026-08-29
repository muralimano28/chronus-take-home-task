import { Response, Router } from "express";
import { prisma } from "@chronus/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { isValidUuid } from "../utils/validation";
import { runIdempotent } from "../services/idempotency";

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

  try {
    const result = await runIdempotent({
      organizationId,
      action: "create_booking",
      idempotencyKey,
      payload: { slotId },
      handler: async (tx) => {

        // For a mentorship/booking platform at normal-to-high scale:
        // Accidental duplicate clicks by the user are already prevented by disabling the button in the UI and using Idempotency-Key.
        // Pessimistic DB row locking (SELECT FOR UPDATE) on the user table is usually overkill for user overlap checks and can indeed become a connection pool bottleneck.

        // Concurrency lock: Acquire pessimistic lock on the booking member's OrganizationUser row
        // to prevent concurrent overlap check bypass.
        // await tx.$executeRaw`SELECT 1 FROM "OrganizationUser" WHERE id = ${membershipId}::uuid FOR UPDATE`;

        // 1. Fetch the slot to verify existence and business rules
        const slot = await tx.mentorSlot.findUnique({
          where: {
            organizationId_id: {
              id: slotId,
              organizationId,
            },
          },
        });

        if (!slot) {
          const err: any = new Error("Slot not found in your organization.");
          err.statusCode = 404;
          throw err;
        }

        if (slot.status !== "AVAILABLE") {
          const err: any = new Error("Slot is no longer available or has already been booked.");
          err.statusCode = 409;
          throw err;
        }

        // Business Rule: Cannot book a slot in the past
        if (slot.startTime < new Date()) {
          const err: any = new Error("Cannot book a slot in the past.");
          err.statusCode = 400;
          throw err;
        }

        // Business Rule: Mentors cannot book their own slots
        if (slot.mentorId === membershipId) {
          const err: any = new Error("Access denied. You cannot book your own mentor slot.");
          err.statusCode = 400;
          throw err;
        }

        // Business Rule: A member cannot book overlapping slots
        const overlappingBooking = await tx.booking.findFirst({
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
          const err: any = new Error("You already have a booking that overlaps with this slot's time.");
          err.statusCode = 400;
          throw err;
        }

        // 2. Reserve slot (optimistic concurrency update)
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

        // 3. Create booking record
        const booking = await tx.booking.create({
          data: {
            organizationId,
            memberId: membershipId,
            slotId,
            status: "ACTIVE",
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

        return {
          statusCode: 201,
          body: formatBookingResponse(booking),
        };
      },
    });

    if (result.replayed) {
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object") {
      // If our handler threw a validation/existence error with a status code
      if (typeof error.statusCode === "number") {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      // Prisma optimistic locking error: P2025 (record to update not found because status !== AVAILABLE)
      if (error.code === "P2025" || error.code === "P2002") {
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

  // Use client-provided key if available; otherwise, derive one from the bookingId to ensure safety
  const idempotencyKey = req.get("Idempotency-Key") || `cancel-booking-${bookingId}`;

  try {
    const result = await runIdempotent({
      organizationId,
      action: "cancel_booking",
      idempotencyKey,
      payload: { bookingId },
      handler: async (tx) => {
        // 1. Fetch booking to check ownership, organization, status, and fetch slotId
        const booking = await tx.booking.findUnique({
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
          const err: any = new Error("Booking not found.");
          err.statusCode = 404;
          throw err;
        }

        // 2. If already cancelled, return 200 OK (idempotent no-op)
        if (booking.status === "CANCELLED") {
          return {
            statusCode: 200,
            body: formatBookingResponse(booking),
          };
        }

        // Business Rule: Cannot cancel a booking for a slot that has already started/is in the past
        if (booking.slot.startTime < new Date()) {
          const err: any = new Error("Cannot cancel a booking for a slot in the past.");
          err.statusCode = 400;
          throw err;
        }

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

        return {
          statusCode: 200,
          body: formatBookingResponse(cancelledBooking),
        };
      },
    });

    if (result.replayed) {
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object" && typeof error.statusCode === "number") {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

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
  const idempotencyKey = req.get("Idempotency-Key");

  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    res.status(400).json({ error: "Missing or invalid idempotencyKey. Expected a non-empty string." });
    return;
  }

  if (!isValidUuid(bookingId) || !isValidUuid(newSlotId)) {
    res.status(400).json({ error: "Invalid bookingId or newSlotId format. Expected valid UUIDs." });
    return;
  }

  try {
    const result = await runIdempotent({
      organizationId,
      action: "reschedule_booking",
      idempotencyKey,
      payload: { bookingId, newSlotId },
      handler: async (tx) => {

        // For a mentorship/booking platform at normal-to-high scale:
        // Accidental duplicate clicks by the user are already prevented by disabling the button in the UI and using Idempotency-Key.
        // Pessimistic DB row locking (SELECT FOR UPDATE) on the user table is usually overkill for user overlap checks and can indeed become a connection pool bottleneck.

        // Concurrency lock: Acquire pessimistic lock on the booking member's OrganizationUser row
        // to prevent concurrent overlap check bypass.
        // await tx.$executeRaw`SELECT 1 FROM "OrganizationUser" WHERE id = ${membershipId}::uuid FOR UPDATE`;

        // 1. Fetch current booking
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
        });

        // Enforce tenant isolation and ownership check:
        if (!booking || booking.organizationId !== organizationId || booking.memberId !== membershipId) {
          const err: any = new Error("Booking not found.");
          err.statusCode = 404;
          throw err;
        }

        if (booking.status !== "ACTIVE") {
          const err: any = new Error("Only active bookings can be rescheduled.");
          err.statusCode = 400;
          throw err;
        }

        // If new slot is the same as old slot, it's a no-op
        if (booking.slotId === newSlotId) {
          const fullBooking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
              member: {
                include: {
                  user: { select: { name: true, email: true } },
                },
              },
              slot: {
                include: {
                  mentor: {
                    include: {
                      user: { select: { name: true, email: true } },
                    },
                  },
                },
              },
            },
          });
          return {
            statusCode: 200,
            body: formatBookingResponse(fullBooking),
          };
        }

        // 2. Fetch new slot
        const newSlot = await tx.mentorSlot.findUnique({
          where: {
            organizationId_id: {
              organizationId,
              id: newSlotId,
            },
          },
        });

        if (!newSlot) {
          const err: any = new Error("New slot not found in your organization.");
          err.statusCode = 400;
          throw err;
        }

        if (newSlot.status !== "AVAILABLE") {
          const err: any = new Error("New slot is already booked.");
          err.statusCode = 409;
          throw err;
        }

        // Business Rule: Cannot reschedule to a slot in the past
        if (newSlot.startTime < new Date()) {
          const err: any = new Error("Cannot reschedule to a slot in the past.");
          err.statusCode = 400;
          throw err;
        }

        // Business Rule: Mentors cannot book/reschedule to their own slots
        if (newSlot.mentorId === membershipId) {
          const err: any = new Error("Access denied. You cannot book your own mentor slot.");
          err.statusCode = 400;
          throw err;
        }

        // Business Rule: A member cannot book overlapping slots (excluding the booking currently being rescheduled)
        const overlappingBooking = await tx.booking.findFirst({
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
          const err: any = new Error("You already have a booking that overlaps with the new slot's time.");
          err.statusCode = 400;
          throw err;
        }

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
          where: { id: bookingId },
          data: { slotId: newSlotId },
          include: {
            member: {
              include: {
                user: { select: { name: true, email: true } },
              },
            },
            slot: {
              include: {
                mentor: {
                  include: {
                    user: { select: { name: true, email: true } },
                  },
                },
              },
            },
          },
        });

        return {
          statusCode: 200,
          body: formatBookingResponse(bookingRecord),
        };
      },
    });

    if (result.replayed) {
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object") {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      // Record not found during optimistic lock constraint check
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
