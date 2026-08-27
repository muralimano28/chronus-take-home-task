Tech stack:
- Monorepo structure with turborepo
- Node JS backend + React frontend (This is an enterprise saas app behind a login screen. So Next JS SEO benefits won't be useful here)
- Postgresql for DB (Booking is transactional and relational)
- Redis for cache 
- Docker for containerization

Functional requirements:
- Allow users to browse mentors and their open slots.
- Allow users to book a slot
- Allow users to view their bookings in "My sessions" page
- Allow users to reschedule their booking
- Allow users to cancel their booking
- Send notifications for each actions related to booking

Non functional requirements:
- Ensure mentor's timezone is taken into account while booking
- Ensure only one member has been assigned to a slot during concurrent bookings
- Ensure double-click doesn't create bookings twice
- Ensure multi-tenant isolation is handled
- Use persisted data model with migrations
- Write tests for hard paths (concurrency, idempotency)
- Add availability caching and invalidation
- Add logs and traceability
- Use background jobs or queue for sending notifications related to booking

API contracts:
- GET /:org-id/mentors
- GET /:org-id/mentors/:mentor-id/slots
- POST /bookings
- GET  /bookings
- POST /bookings/:booking-id/cancel
- POST /bookings/:booking-id/reschedule

Database schema:
Concurrency/Idempotency strategy: Enforce strict concurrency protection at the database level using a Partial Unique Index on active bookings (`@@unique([slotId], where: { status: "ACTIVE" })`). This restricts uniqueness strictly to rows where the booking status is `ACTIVE`, allowing slots to be re-booked once cancelled. API idempotency is enforced via a unique constraint on `[organizationId, memberID, idempotencyKey]` in the `Booking` table.
Tenant isolation strategy:
Time-zone strategy:
Availability caching strategy:
Tests strategy:
Folder structure:
Delibrate scope cuts:

## Design Decisions

Decision 1 — PostgreSQL over NoSQL
Why: Booking is transactional and relational.

Decision 2 — Database-enforced uniqueness
Why: Application-level checks are insufficient under concurrency.

Decision 3 — Idempotency keys
Why: Clients and networks retry requests.

Decision 4 — UTC timestamps
Why: Avoid ambiguity across timezones/DST.

Decision 5 — Simple auth stub
Why: Authentication isn't the focus of the exercise.

Decision 6 — Availability caching
Why: Availability is read-heavy.

Decision 7 — Async notifications
Why: Notification delivery shouldn't increase booking latency.

Decision 8 — Organization and User identity source
Why: Fetch from Bearer token for security, but allow org-id in mentor URI for easy bookmarking and sharing.

Decision 9 — React + Node.js over Next.js
Why: SEO is not required for this enterprise SaaS app. React + Node.js provides absolute architectural freedom, independent scalability, and a clear migration path.

Decision 10 — Monorepo structure with Turborepo
Why: Enables end-to-end TypeScript safety and code sharing between React and Node.js without publishing private packages, and allows atomic feature updates across frontend and backend in a single commit.

Decision 11 — Prisma ORM over Drizzle ORM
Why: Since the backend will run using long-running Docker containers rather than serverless functions, Drizzle’s primary advantage (its lightweight, near-instant cold-start footprint) is minimized. The team will benefit far more from Prisma's industry-leading developer ergonomics, guardrails, custom schema language, automatic type-safe client generation, and built-in GUI (Prisma Studio) for schema management and migrations.

Decision 12 — Isolated Database Package
Why: Isolating db-related code into its own workspace package (instead of coupling it inside `apps/api`) ensures it can be easily shared and reused across both the API server and the background worker service.

Decision 13 — Shared Global Identity for Multi-Tenancy
Why: Keeps a unified user directory with globally unique emails to allow a seamless onboarding/login UX where users and mentors can easily belong to or switch between multiple organizations. Scope-specific roles and mentorship status (toggled by the user) are modeled per-membership on the `OrganizationUser` join table.

Decision 14 — Minimal Role Hierarchy (Boolean toggles over RBAC)
Why: Keeping roles minimal initially (modeled as simple boolean flags like `isMentor` on the `OrganizationUser` membership) satisfies current requirement vectors without premature abstraction. Fuller Role-Based Access Control (RBAC) schemas can be introduced in a future development phase if complex permissions/roles are required.

Decision 15 — Direct Tenant Identifier (organizationId) on Tenant-Owned Records
Why: Adding the `organizationId` directly to tenant-owned models (such as `MentorSlot` and `Booking`) simplifies authorization and query construction. This enables direct tenant filtering (`where organizationId = ?`) and robust data isolation boundaries without needing to join through parent or relation tables.

Decision 16 — Discrete Slots for Availability and Overlap Prevention
Why: Mentor availability is represented as discrete slots generated by the system. While overlapping slot creation is outside the core member booking flow, we must prevent mentors or administrators from creating overlapping slots. This check should be implemented at the application level during the slot creation flow to ensure scheduling integrity.

Decision 17 — Composite Foreign Keys for Strong Tenant Isolation
Why: Using composite foreign keys (such as linking fields on `[organizationId, mentorId]` to `[organizationId, id]`) prevents mismatched associations at the database constraint level. This guarantees that a booking's member, slot, and organization belong to the exact same tenant, eliminating cross-tenant data pollution bugs.

Decision 18 — Partial Unique Index for Concurrency Control
Why: Using a partial unique index on the bookings table (WHERE status = 'ACTIVE') ensures that a slot can only have at most one active booking at any time. When a booking is cancelled, the constraint is released, permitting re-booking of the slot while preserving the historical cancelled booking record for audits. This protects against concurrent booking race conditions at the database level.