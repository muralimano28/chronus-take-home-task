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

Decision 21 — Sequential Integration Testing in Shared Database
Why: To test database features like unique constraints, concurrency, and transactions, integration tests must run against a real PostgreSQL instance. Since running test files in parallel would cause race conditions and data conflicts (where one test deletes rows that another is reading), we configure Vitest to run test suites sequentially using `fileParallelism: false`. This ensures complete data isolation between test files without complex dynamic schema provisioning.

Decision 22 — Verification of JWT Claims Against Database State (Single Source of Truth)
Why: Relying strictly on mutable claims embedded in a client-side JWT (such as `isMentor` or role tags) introduces security vulnerabilities if privileges are changed, disabled, or revoked. To mitigate this risk, the authentication middleware utilizes only the identity identifiers (`membershipId` and `organizationId`) from the token, and queries the database directly to confirm the membership remains valid. Any downstream endpoint requiring specific capabilities (like slots administration or mentor validations) fetches permissions directly from the database record rather than consuming claims from the token payload.

Decision 23 — Overlapping Booking Prevention
Why: A member should not be allowed to book overlapping slots (i.e., having multiple active sessions at the same time). Enforcing this check at the API layer prevents scheduling conflicts and maintains user calendar consistency.

Decision 24 — Concurrency-Safe Idempotent Replays
Why: In high-concurrency environments, multiple requests with the identical idempotency key may attempt to reserve a slot at the same instant. When the first request succeeds, it marks the slot as `BOOKED`, causing concurrent transactions to fail their state checks. Rather than yielding a generic `409` conflict error for duplicate requests, the server catches the state-transition error and attempts to locate the concurrently created booking. If one exists, it returns a `200` replayed booking payload, honoring the idempotency contract under heavy race conditions.

Decision 25 — Filtering Past Availability Slots
Why: A mentor's availability list must not expose historical or expired slots. Enforcing a filter at the database query level (`startTime >= now`) ensures that members only view and book future slots, reducing API payload sizes and preventing stale booking requests.

Decision 26 — Booking Identity Preservation on Reschedule
Why: Rescheduling does not create a new booking record. Instead, the `slotId` of the existing booking is updated in place. The booking ID represents the customer's overall appointment ticket, while the slotId represents its scheduled time and mentor. Keeping the same booking ID allows clients to track the appointment's history and avoids generating new IDs or creating orphaned records.

Decision 27 — Preventing Past Bookings and Rescheduling
Why: The system must enforce that slot reservations (for new bookings or rescheduled ones) occur in the future. Enforcing this logic at the API controller boundary prevents scheduling discrepancies, calendar history corruption, and logical conflicts resulting from past session assignments.

Decision 28 — Pessimistic Row Locking for Overlap Prevention (SELECT FOR UPDATE) (Temporary)
Why: To prevent concurrent overlap check bypasses (where a single member books multiple overlapping slots at the same time), we lock the member's `OrganizationUser` row using `SELECT ... FOR UPDATE` at the beginning of the transaction. 
* **Downside**: Locking the membership row can lead to database connection pool saturation, transactional deadlocks, or increased API queue latency during high-concurrency periods under a single user account context.
* **Future Mitigation**: To resolve this concurrency and scaling bottleneck, we plan to migrate to a Redis-based distributed lock to coordinate resource access at the application layer without blocking database rows.

Decision 29 — Shared UI package and Tailwind CSS v4 setup
Why: Creating a shared @chronus/ui package with Tailwind CSS v4 and the official @tailwindcss/vite plugin ensures high-performance compilation, clean monorepo architecture, and standard, reusable shadcn components that can be used across multiple frontend applications.

Decision 30 — TanStack Router and Router Devtools Integration
Why: Configuring TanStack Router with file-based routing and devtools in the apps/web Vite project enables robust type-safe URL routing, auto-code-splitting, state management based on search parameters, and a dedicated debugging panel.

Decision 31 — Axios Integration with Cookie Credentials
Why: Setting up Axios with `withCredentials: true` by default ensures that JWT cookies stored in the browser are securely and automatically attached to API requests, fulfilling our multi-tenant and secure authentication requirements.

Decision 32 — Client-side Session Cache in LocalStorage (Temporary)
Why: Storing non-sensitive user metadata (name, email, timezone, organizationName) in `localStorage` allows the client application to instantly restore UI display state on browser page refreshes, avoiding layout shifts or a "flash of unauthenticated state". 
* **Downside**: Storing state in `localStorage` can lead to client-side stale data if the user's membership details or organization name changes on the server. The client will remain unaware of the server-side updates until they log out and log back in.
* **Future Mitigation**: To resolve this security and sync downside, we plan to implement a `/auth/me` (or `/auth/session`) endpoint on the API server. Upon app mount, the client will fetch the authenticated session directly from this endpoint, verifying the cookie-based JWT token and populating the context state dynamically from the database.

Decision 33 — Favoring Idempotency Keys over Pessimistic Row Locking for Overlap Checks
Why: We decided to eliminate pessimistic database row locking (`SELECT ... FOR UPDATE` on `OrganizationUser`) in favor of relying on strict API **Idempotency Keys** paired with standard transactional overlap validation queries.

### Detailed Rationale & Context:
* **The Problem (Race Condition vs. Resource Saturation)**: In booking workflows (create & reschedule), there are two distinct concurrency concerns:
  1. *Slot Contention (Multi-User)*: Multiple users competing for the exact same mentor slot simultaneously. This is fully protected by database-level constraints (atomic state updates and unique indexes on `slotId`).
  2. *Member Overlap (Single-User)*: A single member attempting to book two distinct slots that overlap in time (e.g. 10:00–11:00 AM and 10:30–11:30 AM). Under standard `Read Committed` isolation levels, simultaneous requests from the same user could theoretically pass the `findMany` overlap check before either transaction commits.
* **Why Pessimistic Locking Was Reevaluated**:
  * *Low Occurrence Probability*: A genuine human user creating two overlapping sessions at the exact same millisecond across multiple tabs/devices is an extreme edge case.
  * *High Infrastructure Cost*: Placing a pessimistic row lock (`FOR UPDATE`) on the `OrganizationUser` table serializes all operations for that user at the database engine level. This holds open database connections in the connection pool, increases transaction duration, heightens deadlock risks, and severely bottlenecks throughput during high-traffic spikes.
* **Pros of Idempotency-Driven Optimistic Checking**:
  * **Zero Database Lock Overhead**: Database transactions execute in parallel without acquiring blocking row locks on user records, drastically improving throughput and minimizing connection pool exhaustion.
  * **Natural Replay and Double-Click Protection**: Client-side single-flight disablement and backend `Idempotency-Key` tracking prevent accidental duplicate submissions and network retries from executing multiple bookings.
  * **Cleaner Architecture**: Database responsibility remains focused on data consistency and constraints, avoiding artificial serialization locks on parent entities.
* **Cons & Trade-offs**:
  * In the theoretical scenario where a malicious actor sends two concurrent requests with *different* `Idempotency-Key` headers for overlapping time slots within the same 50ms window, the overlap check could pass for both.
* **Future Mitigations (If Strict Overlap Invariance is Demanded at Scale)**:
  1. *PostgreSQL Range Exclusion (`EXCLUDE USING GIST`)*: Define a Postgres GiST exclusion constraint on `(memberId WITH =, tstzrange(startTime, endTime) WITH &&)` so that the storage engine rejects overlapping active ranges atomically without explicit row locks.
  2. *Application-Level Distributed Locks (Redis / Redlock)*: Acquire a lightweight, non-blocking lock on `lock:member:<membershipId>` in memory (with TTL < 2s) to coordinate concurrency without touching database locks.

Decision 34 — Page & Limit Pagination Contract for Mentors Listing
Why: To prevent unbounded database memory usage, slow query execution, and large network payloads as organizations scale, the `GET /mentors` endpoint now enforces pagination using `page` and `limit` query parameters with safe defaults (page=1, limit=10, max=100). The endpoint returns a standard envelope `{ data: Mentor[], pagination: { total, page, limit, totalPages } }`, enabling clean frontend pagination controls and predictable API performance.

Decision 35 — Scoped Date Range Filtering on Mentor Slots API
Why: To support calendar and availability views without over-fetching distant future availability, `GET /mentors/:mentorId/slots` supports optional `startDate` and `endDate` query parameters (ISO 8601 strings). When `endDate` is omitted, the API automatically defaults to a **30-day upper bound window** from `startDate` (or `now`). The endpoint enforces validation (dates must be valid and `startDate <= endDate`) while continuing to guarantee that expired past slots (`< now`) are never returned, even if an earlier `startDate` is requested.

Decision 36 — Redis Monorepo Package Extraction (`@chronus/redis`)
Why: To support multi-service architectures across the monorepo (e.g. `apps/api`, future background notification workers, and scheduled jobs), Redis client instantiation and connection management are centralized into a dedicated `@chronus/redis` package. This prevents duplicate client connection pools and ensures standardized error handling, connection retry logic, and environment configuration across all services.

Decision 37 — Versioned Cache-Aside Strategy for Mentors and Availability Slots
Why: To handle high-concurrency read traffic while ensuring near-instant cache invalidation upon state changes without expensive key scanning (`KEYS` / `SCAN`), we adopted a **Versioned Cache-Aside** pattern with strict tenant isolation and resilient fallback:

### Key Design Details:
1. **Cache Normalization & Partitioning**:
   - **Mentor Directory**: Partitioned by organization, version, page, and limit: `org:<orgId>:mentors:v<version>:page:<page>:limit:<limit>` (TTL: 24 hours). Limit inputs are normalized to `[10, 20, 50, 100]` to maximize cache hit ratios.
   - **Mentor Slots Availability**: Partitioned by organization, mentor, version, and concrete date boundaries: `org:<orgId>:mentor:<mentorId>:slots:v<version>:start:<startDate>:end:<endDate>` (TTL: 15 minutes). Supported predefined range queries (`today`, `next_7_days`, `next_30_days`, `this_month`) compute explicit `YYYY-MM-DD` string keys to avoid cache drift across midnight transitions. Custom arbitrary date ranges bypass the cache.

2. **$O(1)$ Atomic Invalidation via Version Bumping**:
   - Instead of scanning or purging hundreds of pagination and range keys across Redis, an integer version key is maintained per scope (`org:<orgId>:mentors:version` and `org:<orgId>:mentor:<mentorId>:slots:version`).
   - Mutations (booking creation, cancellation, rescheduling) atomically increment the version via `INCR` (with exponential backoff retries in a background unawaited task). Incrementing the version instantly invalidates all cached views for that mentor/organization in $O(1)$ time, while old keys naturally expire via TTL and LRU eviction (`--maxmemory 256mb --maxmemory-policy allkeys-lru` configured in `docker-compose.yml`).
   - For reschedule operations, both the old mentor's slots version and the new mentor's slots version are bumped (deduplicating if rescheduling with the same mentor).

3. **Resilience & Graceful Degradation**:
   - Redis lookups are wrapped in fail-safe try/catch blocks. If Redis is unavailable or fails to return a version, the API gracefully degrades to querying PostgreSQL directly, ensuring zero downtime for end users.
   - Write operations to the cache use unawaited promises (`.catch(...)`), preventing cache write latency or Redis write errors from degrading API response times.

Decision 38 — Transactional Outbox Pattern for Asynchronous Notifications
Why: In high-reliability distributed architectures, dispatching notifications (emails, Slack messages, push alerts) directly inside or immediately after an HTTP request creates a dual-write vulnerability (e.g. database commit succeeds but message broker/network call fails, resulting in lost notifications; or notification is dispatched but database transaction rolls back, sending false alarms). 

To guarantee **at-least-once delivery** without coupling API response latency to third-party notification services, we implement the **Transactional Outbox Pattern**:
- **Atomic Persistence**: An `OutboxEvent` record (containing `eventType`, `aggregateId`, and structured `payload` with `status: PENDING`) is written within the exact same database transaction (`tx`) as the state mutation (e.g. `POST /bookings`).
- **Guaranteed Consistency**: If the booking creation transaction fails or rolls back, no outbox event is persisted. If the transaction commits, the event is guaranteed to be durably saved in PostgreSQL.
- **Decoupled Worker Processing**: A separate background worker periodically polls or consumes pending outbox events, dispatches notifications with retries and exponential backoff, and marks the event `PUBLISHED` upon success.
- **Self-Contained Event Payload Strategy**: The event payload is fully self-contained (includes member name, member email, mentor name, mentor email, mentor timezone, start/end timestamps, and booking ID). Background workers do not query the database to assemble email/notification content, which drastically reduces database read contention, protects workers against future schema changes, and ensures notifications reflect the exact snapshot of data at the time of the event.

Decision 39 — Shared RabbitMQ Client with Auto-Reconnect & Dead-Letter Queueing (`@chronus/rabbitmq`)
Why: To provide reliable asynchronous messaging between our API outbox publisher and background notification workers, we created a dedicated `@chronus/rabbitmq` package designed for high availability and fault tolerance:
- **Resilient Auto-Reconnection**: Reconnects automatically on socket drops or connection errors with exponential backoff (starting at 3s with a 1.5x multiplier capped at 30s) and handles re-assertion of channels.
- **Declarative Queue & Dead-Letter Topology**: Helper `assertTopology(...)` automatically declares durable primary queues, sets up corresponding Dead Letter Exchanges (`<queue>.dlx`), and binds Dead Letter Queues (`<queue>.dlq`).
- **Safe Poison Message Isolation**: Unhandled message processing errors in `consume(...)` reject messages with `requeue: false` (`nack`), routing unparseable or repeatedly failing messages directly into the DLQ without blocking the consumer pipeline.
- **Message Durability**: All published messages default to `persistent: true` with JSON content typing.

Decision 40 — Event-Driven Email Notification Worker Service (`apps/notification-worker`)
Why: Mentoring session lifecycle events (`BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`) require transactional email notifications to both the member and mentor without degrading HTTP response latency or burdening the primary database.
* **Worker Isolation**: Implemented a standalone consumer worker [`apps/notification-worker`](file:///Users/mano/workspace/chronus-take-home-task/apps/notification-worker) decoupled from the web and API servers.
* **Zero-DB Payload Strategy**: The worker relies entirely on the self-contained event payload published through RabbitMQ without issuing secondary database read queries.
* **Dual-Timezone Localization**: Uses pure date utilities from `@chronus/utils` (`formatDateInTimezone`, `formatTimeRangeInTimezone`) to format appointment dates and times localized to the member's and mentor's individual configured timezones (e.g. `America/New_York` vs `Asia/Kolkata`).
* **Reliable Acknowledgment**: Consumer operates with `autoAck: false` (manual acknowledgment) and `prefetch: 10`. Messages are acknowledged (`ch.ack`) strictly after successful email delivery; uncaught exceptions trigger `nack(msg, false, false)` to route poisoned messages to the Dead Letter Queue (`notification.email.queue.dlq`).

Decision 41 — Concurrency-Safe Transactional Outbox Publisher Worker (`apps/event-publisher-worker`)
Why: To reliably bridge database transactions and RabbitMQ message broker without missing events or causing duplicate publishing under horizontal scaling:
* **`FOR UPDATE SKIP LOCKED` Polling**: The publisher queries pending `OutboxEvent` records in batches using PostgreSQL's `FOR UPDATE SKIP LOCKED`. This allows multiple outbox worker instances to run concurrently across replicas without stepping on each other or experiencing row lock contention.
* **Immediate Batch Draining**: If a batch yields events, the worker immediately fetches the next batch without waiting for `POLL_INTERVAL_MS`, minimizing queue lag during traffic bursts while sleeping during idle periods.
* **Resilient Retry Lifecycle**: If publishing to RabbitMQ fails, the event remains in `PENDING` state to be retried on subsequent polling intervals rather than being dropped.

Decision 42 — Dual-Target Module Exports for Monorepo Shared Packages (`@chronus/utils`)
Why: In a full-stack TypeScript monorepo, shared packages (like `@chronus/utils`) are consumed simultaneously by different runtimes:
1. **Frontend / Vite (`import`)**: Requires direct TypeScript source (`./src/index.ts`) for hot-module reloading and fast dev bundling without requiring continuous background compilation.
2. **Backend / Workers / Docker (`node` / CommonJS `require`)**: Requires compiled CommonJS (`./dist/src/index.js`) and declarations (`./dist/src/index.d.ts`) since production Node.js cannot execute raw TypeScript files with type annotations at runtime.
* **Solution**: Configured conditional package exports in `package.json` with `"import"` pointing to `./src/index.ts` and `"default"` / `"types"` pointing to `./dist/`, providing seamless compatibility across all development and production container environments.

Decision 43 — Complete Containerization & Health-Check Orchestration in Docker Compose
Why: To guarantee that the full local environment (PostgreSQL, Redis, RabbitMQ, API, Workers, and Web frontend) can be spun up deterministically with a single `docker compose up` command:
* **Multi-Stage Docker Builds**: Created optimized multi-stage Dockerfiles leveraging Turborepo's `turbo prune` for fast caching, minimal image size, and non-root execution (`adduser --system`).
* **Deep Health Check Probing**: Added healthchecks across all services (`pg_isready` for Postgres, `redis-cli ping` for Redis, `rabbitmq-diagnostics` for RabbitMQ, HTTP health endpoint probe for API, Nginx wget probe for Web, and process liveness for background workers).
* **Strict Health-Gated Startup Ordering**: Configured `depends_on: condition: service_healthy` so downstream services (such as workers and web frontend) only start once API migrations and core infrastructure are fully healthy and ready to accept traffic.

Decision 44 — Safe Production Database Migrations and Entrypoint Seeding (`docker-entrypoint.sh`)
Why: To ensure containerized deployments are self-initializing without risking unintended data loss:
* **Atomic Migration on Startup**: `docker-entrypoint.sh` runs `prisma migrate deploy` before launching the Express process, ensuring the database schema is always in sync with application code.
* **Environment-Gated Seeding**: Added an optional `RUN_SEED` flag (`RUN_SEED="true"`) to the entrypoint. When enabled (for development, staging, or automated review environments), it executes the database seed script to populate test organizations, mentors, members, and availability slots. For live production environments, setting `RUN_SEED="false"` guarantees existing customer data is never overwritten.