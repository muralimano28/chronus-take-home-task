import { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "@chronus/db";
import { redis } from "@chronus/redis";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { isValidUuid } from "../utils/validation";
import { runIdempotent } from "../services/idempotency";
import { getContext } from "@chronus/logger";
import { logger } from "../logger";

const router = Router();

// Default TTL for version keys (7 days) so inactive mentor slot versions expire cleanly
const VERSION_KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Increments the mentor's availability slots cache version in Redis with full-jitter exponential backoff
 * and refreshes its TTL so it never persists indefinitely in Redis.
 */
async function bumpMentorSlotsVersion(organizationId: string, mentorId: string, maxRetries = 3) {
  const BASE_DELAY_MS = 50;
  const key = `org:${organizationId}:mentor:${mentorId}:slots:version`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, VERSION_KEY_TTL_SECONDS);
      await pipeline.exec();
      return;
    } catch (err) {
      if (attempt === maxRetries) {
        logger.error(`[Redis Invalidation Error] Failed to bump slots version for mentor ${mentorId} after ${maxRetries} attempts:`, { error: err });
      } else {
        // Full jitter exponential backoff: random between [0, base * 2^(attempt - 1)] to avoid synchronized retry storms
        const maxBackoff = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitteredDelay = Math.floor(Math.random() * maxBackoff);
        await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
      }
    }
  }
}

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
    logger.error(`Failed to fetch bookings for member ${membershipId} in org ${organizationId}:`, { error });
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
      membershipId,
      action: "create_booking",
      idempotencyKey,
      payload: { slotId },
      handler: async (tx) => {

        // Double-booking & Concurrency Control:
        // 1. Mentee overlap prevention: Enforced via PostgreSQL GiST exclusion constraint (`no_overlapping_active_member_bookings`).
        //    This completely eliminates race conditions at the database level without requiring connection-bottlenecking pessimistic table/row locks (`SELECT FOR UPDATE`).
        // 2. Slot concurrency: Optimistically guarded via `tx.mentorSlot.update({ where: { status: "AVAILABLE" } })`.
        // 3. UI/Network retries: Handled by Idempotency-Key and disabling submit buttons on click.

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

        // 3. Create booking record with slotStartTime and slotEndTime for DB-enforced exclusion constraint
        const booking = await tx.booking.create({
          data: {
            organizationId,
            memberId: membershipId,
            slotId,
            slotStartTime: slot.startTime,
            slotEndTime: slot.endTime,
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

        // 4. Record transactional outbox event for reliable notification dispatch
        const bookingBody = formatBookingResponse(booking);
        const correlationId = getContext()?.correlationId || randomUUID();

        await tx.outboxEvent.create({
          data: {
            correlationId,
            eventType: "BOOKING_CREATED",
            aggregateId: booking.id,
            payload: bookingBody,
            status: "PENDING",
          },
        });

        return {
          statusCode: 201,
          body: bookingBody,
        };
      },
    });

    if (result.replayed) {
      logger.info(`Booking request replayed via idempotency key: ${result.body?.id}`, {
        event: "booking.idempotent_retry",
        bookingId: result.body?.id,
        idempotencyKey,
      });
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      logger.info(`Booking created successfully: ${result.body?.id}`, {
        event: "booking.created",
        bookingId: result.body?.id,
        slotId: result.body?.slot?.id,
      });
      // Invalidate cached mentor availability slots by incrementing the version (with retries)
      const mentorId = result.body?.slot?.mentor?.membershipId;
      if (mentorId) {
        await bumpMentorSlotsVersion(organizationId, mentorId);
      }
      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object") {
      // If our handler threw a validation/existence error with a status code
      if (typeof error.statusCode === "number") {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      // Check for PostgreSQL exclusion constraint violation (error code 23P01 / 40P01 / 40001 / P2034) or custom constraint name
      const isExclusionViolation =
        error.code === "23P01" ||
        error.code === "P2034" ||
        error.code === "40P01" ||
        error.code === "40001" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "23P01" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "40P01" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "40001" ||
        (error.meta?.message && error.meta.message.includes("no_overlapping_active_member_bookings")) ||
        (error.message && error.message.includes("no_overlapping_active_member_bookings"));

      if (isExclusionViolation) {
        logger.warn("Booking rejected: overlapping active member booking", {
          event: "booking.conflict",
          conflictType: "overlapping_member_booking",
          slotId,
        });
        res.status(409).json({ error: "You already have an active booking overlapping with this time slot." });
        return;
      }

      // Prisma optimistic locking error: P2025 (record to update not found because status !== AVAILABLE)
      if (error.code === "P2025") {
        logger.warn("Booking rejected: slot already booked or unavailable", {
          event: "booking.conflict",
          conflictType: "slot_already_booked",
          slotId,
        });
        res.status(409).json({ error: "Slot is no longer available or has already been booked." });
        return;
      }

      // Distinct unique constraint violation (P2002)
      if (error.code === "P2002") {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(", ")
          : (error.meta?.target || "field");

        logger.warn(`Booking rejected: unique constraint violation on ${target}`, {
          event: "booking.conflict",
          conflictType: "unique_constraint_violation",
          target,
          slotId,
        });
        res.status(400).json({ error: `A record with this ${target} already exists.` });
        return;
      }
    }

    logger.error(`Failed to create booking for member ${membershipId} in org ${organizationId}:`, { error });
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
      membershipId,
      action: "cancel_booking",
      idempotencyKey,
      payload: { bookingId },
      handler: async (tx) => {
        // 1. Fetch booking to check ownership, organization, status, and fetch slotId
        const booking = await tx.booking.findUnique({
          where: {
            organizationId_id: {
              organizationId,
              id: bookingId,
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

        // Enforce tenant isolation and ownership check:
        // User must belong to the same organization and must be the member who booked it.
        if (!booking || booking.memberId !== membershipId) {
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

        // 1. Mark the booking as cancelled (optimistically checking status: ACTIVE)
        const cancelledBooking = await tx.booking.update({
          where: {
            id: bookingId,
            organizationId,
            status: "ACTIVE",
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

        // 2. Free up the slot (optimistically checking status: BOOKED)
        await tx.mentorSlot.update({
          where: {
            id: booking.slotId,
            organizationId,
            status: "BOOKED",
          },
          data: {
            status: "AVAILABLE",
          },
        });

        // 3. Record transactional outbox event for reliable cancellation notification dispatch
        const cancelledBookingBody = formatBookingResponse(cancelledBooking);
        const correlationId = getContext()?.correlationId || randomUUID();

        await tx.outboxEvent.create({
          data: {
            correlationId,
            eventType: "BOOKING_CANCELLED",
            aggregateId: cancelledBooking.id,
            payload: cancelledBookingBody,
            status: "PENDING",
          },
        });

        return {
          statusCode: 200,
          body: cancelledBookingBody,
        };
      },
    });

    if (result.replayed) {
      logger.info(`Booking cancellation replayed via idempotency key: ${bookingId}`, {
        event: "booking.idempotent_retry",
        bookingId,
        idempotencyKey,
      });
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      logger.info(`Booking cancelled successfully: ${bookingId}`, {
        event: "booking.cancelled",
        bookingId,
        slotId: result.body?.slot?.id,
      });
      // Invalidate cached mentor availability slots by incrementing the version (with retries)
      const mentorId = result.body?.slot?.mentor?.membershipId;
      if (mentorId) {
        await bumpMentorSlotsVersion(organizationId, mentorId);
      }
      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object") {
      if (typeof error.statusCode === "number") {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      // Record not found due to optimistic status mismatch (already cancelled or slot not booked)
      if (error.code === "P2025") {
        logger.warn("Booking cancellation rejected: booking or slot is no longer in valid state", {
          event: "booking.cancellation_conflict",
          bookingId,
        });
        res.status(409).json({ error: "Booking is no longer active or has already been cancelled." });
        return;
      }
    }

    logger.error(`Failed to cancel booking ${bookingId} for member ${membershipId} in org ${organizationId}:`, { error });
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
    let oldMentorId: string | null = null;

    const result = await runIdempotent({
      organizationId,
      membershipId,
      action: "reschedule_booking",
      idempotencyKey,
      payload: { bookingId, newSlotId },
      handler: async (tx) => {

        // Double-booking & Concurrency Control:
        // 1. Mentee overlap prevention: Enforced via PostgreSQL GiST exclusion constraint (`no_overlapping_active_member_bookings`).
        //    This completely eliminates race conditions at the database level without requiring connection-bottlenecking pessimistic table/row locks (`SELECT FOR UPDATE`).
        // 2. Slot concurrency: Optimistically guarded via `tx.mentorSlot.update({ where: { status: "AVAILABLE" } })`.
        // 3. UI/Network retries: Handled by Idempotency-Key and disabling submit buttons on click.

        // 1. Fetch current booking
        const booking = await tx.booking.findUnique({
          where: {
            organizationId_id: {
              organizationId,
              id: bookingId,
            },
          },
          include: {
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

        // Enforce tenant isolation and ownership check:
        if (!booking || booking.memberId !== membershipId) {
          const err: any = new Error("Booking not found.");
          err.statusCode = 404;
          throw err;
        }

        if (booking.status !== "ACTIVE") {
          const err: any = new Error("Only active bookings can be rescheduled.");
          err.statusCode = 400;
          throw err;
        }

        // Business Rule: Cannot reschedule a booking whose slot is already in the past
        if (booking.slot.startTime < new Date()) {
          const err: any = new Error("Cannot reschedule a booking that is already in the past.");
          err.statusCode = 400;
          throw err;
        }

        // If new slot is the same as old slot, it's a no-op
        if (booking.slotId === newSlotId) {
          const fullBooking = await tx.booking.findUnique({
            where: {
              organizationId_id: {
                organizationId,
                id: bookingId,
              },
            },
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

        // 1. Reserve new slot first (optimistic locking checks status: AVAILABLE)
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

        // 2. Free up old slot (optimistic check: status must be BOOKED)
        await tx.mentorSlot.update({
          where: {
            id: booking.slotId,
            organizationId,
            status: "BOOKED",
          },
          data: {
            status: "AVAILABLE",
          },
        });

        // 3. Atomically update booking, asserting that slotId has not changed and status is still ACTIVE
        // (prevents concurrent reschedule races from orphaning slots, and prevents resurrecting cancelled bookings)
        const bookingRecord = await tx.booking.update({
          where: {
            id: bookingId,
            organizationId,
            slotId: booking.slotId,
            status: "ACTIVE",
          },
          data: {
            slotId: newSlotId,
            slotStartTime: newSlot.startTime,
            slotEndTime: newSlot.endTime,
          },
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

        // 3. Capture the old mentor ID in closure only after all DB operations succeed
        oldMentorId = booking.slot.mentorId;

        // 4. Record transactional outbox event for reliable reschedule notification dispatch
        const rescheduledBookingBody = formatBookingResponse(bookingRecord);
        const correlationId = getContext()?.correlationId || randomUUID();

        await tx.outboxEvent.create({
          data: {
            correlationId,
            eventType: "BOOKING_RESCHEDULED",
            aggregateId: bookingRecord.id,
            payload: {
              ...rescheduledBookingBody,
              previousSlot: {
                id: booking.slot.id,
                startTime: booking.slot.startTime,
                endTime: booking.slot.endTime,
                mentor: {
                  membershipId: booking.slot.mentor.id,
                  userId: booking.slot.mentor.userId,
                  name: booking.slot.mentor.user.name,
                  email: booking.slot.mentor.user.email,
                  timezone: booking.slot.mentor.timezone,
                },
              },
            },
            status: "PENDING",
          },
        });

        return {
          statusCode: 200,
          body: rescheduledBookingBody,
        };
      },
    });

    if (result.replayed) {
      logger.info(`Booking reschedule replayed via idempotency key: ${bookingId}`, {
        event: "booking.idempotent_retry",
        bookingId,
        idempotencyKey,
      });
      res.setHeader("x-idempotent-replayed", "true");
      res.status(200).json(result.body);
    } else {
      logger.info(`Booking rescheduled successfully: ${bookingId}`, {
        event: "booking.rescheduled",
        bookingId,
        newSlotId,
      });
      // Invalidate cached availability slots for both old and new mentors (deduplicating if the same mentor)
      const newMentorId = result.body?.slot?.mentor?.membershipId;

      const mentorIdsToInvalidate = new Set<string>();
      if (oldMentorId) mentorIdsToInvalidate.add(oldMentorId);
      if (newMentorId) mentorIdsToInvalidate.add(newMentorId);

      for (const mId of mentorIdsToInvalidate) {
        await bumpMentorSlotsVersion(organizationId, mId);
      }

      res.status(result.statusCode).json(result.body);
    }
  } catch (error: any) {
    if (error && typeof error === "object") {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      // Check for PostgreSQL exclusion constraint violation (error code 23P01 / 40P01 / 40001 / P2034) or custom constraint name
      const isExclusionViolation =
        error.code === "23P01" ||
        error.code === "P2034" ||
        error.code === "40P01" ||
        error.code === "40001" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "23P01" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "40P01" ||
        error.meta?.driverAdapterError?.cause?.originalCode === "40001" ||
        (error.meta?.message && error.meta.message.includes("no_overlapping_active_member_bookings")) ||
        (error.message && error.message.includes("no_overlapping_active_member_bookings"));

      if (isExclusionViolation) {
        logger.warn("Booking reschedule rejected: overlapping active member booking", {
          event: "booking.conflict",
          conflictType: "overlapping_member_booking",
          bookingId,
          newSlotId,
        });
        res.status(409).json({ error: "You already have an active booking overlapping with this time slot." });
        return;
      }

      // Record not found during optimistic lock constraint check
      if (error.code === "P2025") {
        logger.warn("Booking reschedule rejected: slot already booked or unavailable", {
          event: "booking.conflict",
          conflictType: "slot_already_booked",
          bookingId,
          newSlotId,
        });
        res.status(409).json({ error: "New slot is no longer available." });
        return;
      }

      // Distinct unique constraint violation (P2002)
      if (error.code === "P2002") {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(", ")
          : (error.meta?.target || "field");

        logger.warn(`Booking reschedule rejected: unique constraint violation on ${target}`, {
          event: "booking.conflict",
          conflictType: "unique_constraint_violation",
          target,
          bookingId,
          newSlotId,
        });
        res.status(400).json({ error: `A record with this ${target} already exists.` });
        return;
      }
    }
    logger.error(`Failed to reschedule booking ${bookingId} to slot ${newSlotId} for member ${membershipId} in org ${organizationId}:`, { error });
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
      timezone: b.member.timezone,
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
