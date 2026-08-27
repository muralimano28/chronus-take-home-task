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
- GET /mentors
- GET /mentors/:mentor-id/slots
- GET /:org-id/mentors [For admin use]
- GET /:org-id/mentors/:mentor-id/slots [For admin use]
- GET /bookings
- GET /:org-id/members/:member-id/bookings [For admin use]
- POST /bookings
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

Decision 3 — Idempotency-Key in HTTP Headers
Why: Clients and networks frequently retry requests. Enforcing idempotency using the standard `Idempotency-Key` request header aligns with industry practices and offers several benefits:
* **Separation of concerns**: Metadata about the request handling (like retries) belongs in the transport headers, keeping the request body clean for pure domain data.
* **Method agnostic**: Headers apply uniformly across methods like `POST`, `PUT`, and `PATCH`, whereas forcing it into a request body requires parsing JSON/XML payloads for every single endpoint type.
* **Ecosystem convention**: Major platforms like Stripe and PayPal popularized `Idempotency-Key` as the standard header name, aligning with [IETF drafts](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-02). We avoid older custom variants like `X-Idempotency-Key`.

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

Decision 17 — Composite Keys for Multi-Tenant Safety & Query Performance
Why: Utilizing composite keys (such as `[organizationId, id]` on `MentorSlot` and `[organizationId, memberID, idempotencyKey]` on `Booking`) guarantees strict data isolation at the database layer. This ensures that no query can inadvertently reference a resource under a different organization's boundary. 
* **Query Performance**: By exposing composite keys, queries can fetch resources using `prisma.findUnique({ where: { organizationId_id: { organizationId, id } } })` instead of a generic `findFirst`. This leverages the database's composite unique indexes directly for highly efficient index lookups.
* **Refactoring Considerations**: While composite keys make schemas more verbose and make database migrations slightly more complex if columns need to be renamed or detached from their parent tenants, this overhead is justified in a multi-tenant SaaS application where data isolation is paramount and resources (like slots) are permanently bound to their organization.

Decision 18 — Partial Unique Index for Concurrency Control
Why: Using a partial unique index on the bookings table (WHERE status = 'ACTIVE') ensures that a slot can only have at most one active booking at any time. When a booking is cancelled, the constraint is released, permitting re-booking of the slot while preserving the historical cancelled booking record for audits. This protects against concurrent booking race conditions at the database level.

Decision 19 — Self-Booking Prevention
Why: A mentor cannot book a session with themselves. Enforcing this business validation at the API layer prevents data anomalies (e.g., calendar loop conflicts) and ensures logical integrity.

Decision 20 — Optimistic Concurrency Control over Pessimistic Row Locking (`FOR UPDATE`)
Why: Atomic, state-based updates (e.g., updating slot status with a conditional `WHERE status = 'AVAILABLE'`) provide highly performant, lock-free concurrency safety. It avoids database-level transaction queuing and deadlock hazards typical of `SELECT ... FOR UPDATE` row locks, while ensuring that concurrent bookings still fail safely when the slot's state has already transitioned.