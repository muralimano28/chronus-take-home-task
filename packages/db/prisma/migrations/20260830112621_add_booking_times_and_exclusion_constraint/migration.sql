-- 1. Enable btree_gist extension required for mixing UUID equality with temporal range exclusion
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Add columns as nullable first to support existing rows
ALTER TABLE "Booking"
ADD COLUMN "slotStartTime" TIMESTAMPTZ(3),
ADD COLUMN "slotEndTime" TIMESTAMPTZ(3);

-- 3. Backfill slotStartTime and slotEndTime from associated MentorSlot rows
UPDATE "Booking" b
SET
  "slotStartTime" = s."startTime",
  "slotEndTime" = s."endTime"
FROM "MentorSlot" s
WHERE b."slotId" = s.id;

-- 4. Enforce NOT NULL on the columns
ALTER TABLE "Booking"
ALTER COLUMN "slotStartTime" SET NOT NULL,
ALTER COLUMN "slotEndTime" SET NOT NULL;

-- 5. Create Index
CREATE INDEX "Booking_memberId_status_idx" ON "Booking"("memberId", "status");

-- 6. Add Exclusion Constraint for Active Member Bookings Overlap Prevention
ALTER TABLE "Booking"
ADD CONSTRAINT no_overlapping_active_member_bookings
EXCLUDE USING gist (
  "memberId" WITH =,
  tstzrange("slotStartTime", "slotEndTime", '[)') WITH &&
)
WHERE (status = 'ACTIVE');
