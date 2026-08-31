# Chronus — Engineering Decisions

Technical decision log and architectural rationale for the Chronus Multi-Tenant Mentoring Platform.

---

## 1. Decision Summary

| # | Area | Problem | Chosen Approach | Primary Trade-off |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Slot Contention** | Concurrent requests booking the same slot. | PostgreSQL partial unique index + optimistic `AVAILABLE -> BOOKED` transition predicate. | Transactions conflicting on slot availability abort and return `409 Conflict`. |
| **2** | **Member Overlap** | Concurrent requests booking overlapping slots for the same member (TOCTOU). | PostgreSQL `btree_gist` exclusion constraint (`no_overlapping_active_member_bookings`). | Requires PostgreSQL-specific `btree_gist` extension; error codes mapped explicitly in application layer. |
| **3** | **Idempotency** | Network retries and duplicate user form submissions. | Standard `Idempotency-Key` header with canonical SHA-256 payload hashing, scoped per member. | Cached response payload stored in PostgreSQL `IdempotencyKey` table until TTL expiry. |
| **4** | **Leases & Fencing** | Zombie/stalled workers overwriting newer idempotency records after lease expiration. | 30s lock lease with optimistic fencing token (`lockedAt`) asserted on commit. | Stalled requests past 30s lease window abort with `P2025` on commit and roll back all state changes. |
| **5** | **Dual-Write Consistency** | Broker downtime or API crashes losing notification events after DB commit. | Transactional Outbox pattern with `FOR UPDATE SKIP LOCKED` batch polling. | Adds asynchronous polling latency (~2s) between database commit and message broker dispatch. |
| **6** | **Messaging Reliability** | Asynchronous notification delivery and worker crash recovery. | RabbitMQ durable topic exchange with manual consumer acknowledgments (`autoAck: false`) and DLQ. | At-least-once delivery model: worker crash post-dispatch before ACK can result in duplicate emails. |
| **7** | **Availability Caching** | High read volume on mentor availability vs. low mutation volume. | Version-keyed cache-aside in Redis with atomic `INCR` version bumps and fail-open DB fallback. | Fails open to PostgreSQL if Redis is down; transient version bump failure during mutation can serve stale cache until 15m TTL expires. |
| **8** | **Timezones & DST** | Multi-region scheduling and Daylight Saving Time shifts. | UTC `TIMESTAMPTZ(3)` database storage with dynamic IANA timezone presentation (`date-fns-tz`). | All clients and notification workers must parse and format localized times on demand. |
| **9** | **Authorization State** | Stale JWT claims causing privilege escalation if roles change mid-session. | Database-backed hydration of mutable user state (`isMentor`) from `OrganizationUser` on every request. | Incurs one indexed `findUnique` query per authenticated HTTP request. |
| **10**| **Rescheduling Safety** | Concurrent reschedules orphaning newly reserved slots as permanently `BOOKED`. | Atomic transaction asserting `slotId: booking.slotId` and old slot `status: "BOOKED"`. | Conflicting concurrent reschedules fail atomically and roll back all slot reservations. |
| **11**| **System Boundaries** | Organizing code for reuse and independent deployment without microservice overhead. | Turborepo monorepo with discrete packages and separate background worker processes. | Shared packages require internal TypeScript compilation pipelines during builds. |
| **12**| **Scope & Breadth** | Delivering high transactional correctness within a fixed evaluation timeframe. | Vertical slice (Discovery, Booking, Cancellation, Rescheduling) with seeded multi-tenant fixtures. | Full user onboarding CRUD, SSO, and mentor recurring rule management deferred to future iterations. |

---

## 2. Database-Enforced Booking Invariants

### Context
In a mentoring platform, double-booking a mentor slot is a catastrophic data integrity failure. Under high concurrency (e.g., when a popular mentor opens new slots), multiple members submit booking requests for the exact same slot within milliseconds.

### Options Considered
1. **Application-Level Pre-Check (`findUnique`)**: Query the slot status in Node.js before inserting the booking.
2. **Pessimistic Table/Row Locking (`SELECT FOR UPDATE`)**: Lock the slot row explicitly during the transaction.
3. **Database Constraints + Optimistic Update Predicates (Selected)**: Enforce a partial unique index on active bookings and execute an atomic status update `WHERE id = slotId AND status = 'AVAILABLE'`.

### Decision
Adopted a two-layered database defense:
1. A partial unique index: `CREATE UNIQUE INDEX "Booking_slotId_key" ON "Booking"("slotId") WHERE status = 'ACTIVE'`.
2. An optimistic update predicate inside `prisma.$transaction`:
   ```typescript
   await tx.mentorSlot.update({
     where: { id: slotId, organizationId, status: "AVAILABLE" },
     data: { status: "BOOKED" },
   });
   ```

### Why
- **Application pre-checks fail under concurrency**: Two simultaneous requests can both observe `status === 'AVAILABLE'` before either transaction commits.
- **Pessimistic locks create connection bottlenecks**: Holding open row locks during complex multi-entity validation exhausts database connection pools.
- **Optimistic predicates provide ACID safety**: PostgreSQL row-level locks on the `UPDATE` ensure only the first transaction modifies the row (returning rows updated = 1). The second transaction updates 0 rows; Prisma throws `P2025` (`RecordNotFound`), triggering an immediate rollback and a clean `409 Conflict` response to the client.

### Trade-offs
- The second concurrent request fails immediately rather than queuing. This is the desired behavior for interactive booking APIs—users prefer an instant "Slot no longer available" response over prolonged blocking.

### Evidence
- **Schema & Migration**: [`packages/db/prisma/schema.prisma:106`](file:///Users/mano/workspace/chronus-take-home-task/packages/db/prisma/schema.prisma#L106), [`packages/db/prisma/migrations/20260828113750_init_db_setup/migration.sql:84`](file:///Users/mano/workspace/chronus-take-home-task/packages/db/prisma/migrations/20260828113750_init_db_setup/migration.sql#L84).
- **Implementation**: [`apps/api/src/routes/bookings.ts:197-206`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/bookings.ts#L197-L206).
- **Automated Test**: `"allows only one user to book a slot concurrently"` in [`apps/api/tests/integration/bookings.test.ts:11-66`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/bookings.test.ts#L11-L66).
- **Plan Reference**: Decisions 2, 18, 20.

---

## 3. PostgreSQL GiST Exclusion Constraint for Member Overlap

### Context
A member must not be allowed to book overlapping sessions across different mentors or slots (e.g., booking Slot A from 10:00–11:00 with Mentor 1 and Slot B from 10:30–11:30 with Mentor 2).

### Evolution & Discovery
```
[Initial Approach]
Application-level findFirst query for overlapping bookings
       │
       ▼
[Weakness Discovered]
Time-of-Check to Time-of-Use (TOCTOU) race condition: Two concurrent requests
from the same member across distinct slots both pass findFirst before either commits
       │
       ▼
[Alternatives Evaluated]
1. Application-level pre-checks -> Subject to TOCTOU races under concurrency
2. Pessimistic locking (table-level locks) -> Connection pool contention and serialization bottlenecks
3. Distributed locking -> Operational complexity and failure recovery overhead
4. Native PostgreSQL GiST Exclusion Constraint -> Chosen
       │
       ▼
[Final Hardening]
PostgreSQL btree_gist exclusion constraint on (organizationId, memberId, tsrange)
+ Updated integration test runner from `prisma db push` to `prisma migrate deploy`
```

### Decision
Implemented a native PostgreSQL GiST exclusion constraint using `btree_gist`:
```sql
ALTER TABLE "Booking" ADD CONSTRAINT "no_overlapping_active_member_bookings"
EXCLUDE USING gist (
    "organizationId" WITH =,
    "memberId" WITH =,
    tsrange("slotStartTime", "slotEndTime", '[)') WITH &&
) WHERE (status = 'ACTIVE');
```

### Why
- **Interval overlaps span different rows**: Locking a single `MentorSlot` row cannot prevent a member from inserting a conflicting row for a *different* slot.
- **Database engine enforcement**: PostgreSQL evaluates interval intersection (`&&`) over `tsrange("slotStartTime", "slotEndTime", '[)')` atomically at commit time, enforcing the non-overlap invariant at the database layer without distributed lock managers.
- **Test harness synchronization**: Switched `global-setup.ts` from `prisma db push` to `prisma migrate deploy`, ensuring integration tests execute against the exact database engine constraints deployed to production.

### Trade-offs
- Requires the PostgreSQL `btree_gist` extension. Error codes (`23P01`, `P2034`, `40P01`, `40001`) must be intercepted in the API error handler and mapped to `409 Conflict`.

### Evidence
- **Migration**: [`packages/db/prisma/migrations/20260830112621_add_booking_times_and_exclusion_constraint/migration.sql:1-14`](file:///Users/mano/workspace/chronus-take-home-task/packages/db/prisma/migrations/20260830112621_add_booking_times_and_exclusion_constraint/migration.sql#L1-L14).
- **Implementation**: [`apps/api/src/routes/bookings.ts:296-310`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/bookings.ts#L296-L310).
- **Automated Test**: `"prevents concurrent member overlap race condition (TOCTOU)..."` in [`apps/api/tests/integration/bookings.test.ts:114-171`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/bookings.test.ts#L114-L171).
- **Plan Reference**: Decisions 23, 54.

---

## 4. Idempotency-Key Architecture & Keyspace Scoping

### Context
Network drops, client timeouts, and rapid double-clicks cause duplicate HTTP mutation requests. Mutation endpoints (`POST /bookings`, `POST /bookings/:id/cancel`, `POST /bookings/:id/reschedule`) must safely handle retries without creating duplicate bookings or corrupted state, replaying completed responses when identical or safely re-executing if an earlier attempt's lease expired.

### Evolution & Discovery
```
[Initial Approach]
IdempotencyKey unique on [organizationId, action, idempotencyKey]
       │
       ▼
[Security Vulnerability Discovered]
Cross-User Collision & PII Leakage: If Member B in Org 1 submitted a booking
using the same key as Member A (either by collision or guessing), Member B received
Member A's cached booking response containing Member A's private PII and appointment ID
       │
       ▼
[Final Decision]
Added membershipId foreign key and scoped composite uniqueness to:
[organizationId, membershipId, action, idempotencyKey]
```

### Decision
1. Used the standard `Idempotency-Key` HTTP header.
2. Implemented deterministic SHA-256 payload hashing via `canonicalStringify(req.body)` (keys sorted recursively).
3. Scoped keys per member: `@@unique([organizationId, membershipId, action, idempotencyKey], name: "uniqueTenantMemberActionKey")`.

### Why
- **Transport vs. Domain Separation**: Metadata belongs in HTTP headers rather than polluting domain request bodies.
- **Replay of Completed Mutations**: If a request was already processed (`status: "COMPLETED"`), repeating the identical request returns the cached response with `x-idempotent-replayed: true` without hitting the database transaction again.
- **Safe Re-Execution on Lease Expiry**: If a prior attempt stalled or crashed past the 30s lease window, a retry safely reclaims the lease to `STARTED` and executes cleanly, with the commit-time fencing token preventing split-brain overwrites if the old request awakens.
- **Payload Mismatch Protection**: If a client retries the same key with a different `slotId`, the hash check detects the tampering and returns `400 Bad Request`.
- **Tenant & Member Privacy**: Scoping by `membershipId` guarantees that each user operates in an isolated keyspace, completely eliminating cross-user data leakage.

### Trade-offs
- Requires storing `responseBody` JSON in PostgreSQL `IdempotencyKey` table until TTL expiration.

### Evidence
- **Migration**: [`packages/db/prisma/migrations/20260830220300_scope_idempotency_by_member/migration.sql`](file:///Users/mano/workspace/chronus-take-home-task/packages/db/prisma/migrations/20260830220300_scope_idempotency_by_member/migration.sql).
- **Implementation**: [`apps/api/src/services/idempotency.ts:23-35, 78-102`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/services/idempotency.ts#L23-L35).
- **Automated Test**: `"prevents cross-user idempotency key collisions and private data leakage"` in [`apps/api/tests/integration/bookings.test.ts:278-325`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/bookings.test.ts#L278-L325).
- **Plan Reference**: Decisions 3, 24, 63, 68.

---

## 5. Idempotency Leases and Fencing Tokens

### Context
A simple state machine (`STARTED -> COMPLETED`) fails when requests crash or experience extreme latency. If a server dies while processing, the key is left permanently in `STARTED`, blocking all future retries. Conversely, if an expired lock is reclaimed by a retry, a stalled original request must not wake up and overwrite the newer transaction.

### Decision
1. Implemented a **30-second visibility lease**: `lockedAt = NOW()`.
2. Concurrent retries while `status === 'STARTED'` within 30s receive `409 Conflict: Request currently in progress`.
3. Expired leases (`lockedAt < NOW() - 30s`) or `FAILED` keys are reclaimed via atomic `updateMany`.
4. Implemented an **Optimistic Fencing Token** on commit:
   ```typescript
   await tx.idempotencyKey.update({
     where: {
       id: recordId,
       status: "STARTED",
       lockedAt: currentLockTimestamp,
     },
     data: {
       status: "COMPLETED",
       responseCode: result.statusCode,
       responseBody: result.body,
     },
   });
   ```

### Why
- **Lease Reclamation**: Unblocks clients if an API worker crashes mid-flight without waiting for manual operator intervention.
- **Zombie Overwrite Prevention**: If Worker 1 stalls for 35s, Worker 2 reclaims the lease (updating `lockedAt = T2`). When Worker 1 resumes and attempts to commit, its `where: { lockedAt: T1 }` predicate matches 0 rows. Prisma throws `P2025`, causing Worker 1's entire business transaction to abort and roll back cleanly.

### Trade-offs
- A client whose request takes longer than 30 seconds to execute will have its lease reclaimed. 30 seconds is more than sufficient for OLTP booking transactions.

### Evidence
- **Implementation**: [`apps/api/src/services/idempotency.ts:104-165`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/services/idempotency.ts#L104-L165).
- **Automated Tests**: `"reclaims an idempotency key lock if the lease window has expired"` and `"safely handles concurrent retries racing to reclaim a FAILED idempotency key"` in [`apps/api/tests/integration/bookings.test.ts:390-590`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/bookings.test.ts#L390-L590).
- **Plan Reference**: Decision 67.

---

## 6. Transactional Outbox Pattern

### Context
When a booking is confirmed, notification emails must be sent. Directly publishing to RabbitMQ inside the HTTP request creates a dual-write failure mode:
- If the database commit succeeds but the RabbitMQ publish fails (network blip/broker restart), the notification is permanently lost.
- If the RabbitMQ publish succeeds but the database transaction rolls back, a phantom email is sent for a booking that does not exist.

### Decision
Implemented the **Transactional Outbox Pattern**:
1. An `OutboxEvent` record (`status: "PENDING"`, self-contained JSON payload, `correlationId`) is inserted in the exact same PostgreSQL transaction as the booking state change.
2. A separate background worker (`apps/event-publisher-worker`) polls:
   ```sql
   WITH claimed AS (
     SELECT id FROM "OutboxEvent"
     WHERE status = 'PENDING'
        OR (status = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '60 seconds')
     ORDER BY "createdAt" ASC
     LIMIT 50
     FOR UPDATE SKIP LOCKED
   )
   UPDATE "OutboxEvent"
   SET status = 'PROCESSING', "lockedAt" = NOW(), "retryCount" = "retryCount" + 1
   FROM claimed WHERE "OutboxEvent".id = claimed.id
   RETURNING ...;
   ```
3. The worker publishes events to RabbitMQ and marks them `PUBLISHED`.

### Why
- **Guaranteed Event Persistence**: Event creation is bound to the ACID lifecycle of the database transaction.
- **No Broker-Dependent HTTP Latency**: The client request does not wait for RabbitMQ network I/O or notification processing.
- **Horizontal Worker Scalability**: `FOR UPDATE SKIP LOCKED` allows multiple publisher replicas to poll concurrently without race conditions or duplicate claims.

### Trade-offs & Guarantees
- **What is guaranteed**: Reliable asynchronous event capture without dual-write loss, protected by a 60-second processing visibility timeout (`VISIBILITY_TIMEOUT_SECONDS = 60`, distinct from the 30-second API idempotency lease).
- **What is NOT guaranteed**: Sub-millisecond notification delivery (adds ~2s polling interval latency).

### Evidence
- **Implementation**: [`apps/api/src/routes/bookings.ts:250-264`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/bookings.ts#L250-L264), [`apps/event-publisher-worker/src/claim.ts:26-55`](file:///Users/mano/workspace/chronus-take-home-task/apps/event-publisher-worker/src/claim.ts#L26-L55).
- **Automated Tests**: [`apps/event-publisher-worker/tests/outbox.test.ts`](file:///Users/mano/workspace/chronus-take-home-task/apps/event-publisher-worker/tests/outbox.test.ts).
- **Plan Reference**: Decisions 38, 41, 47, 53.

---

## 7. RabbitMQ Asynchronous Delivery & Failure Semantics

### Context
Notification consumers must process booking events, format localized date/time strings, and dispatch emails reliably without dropping messages during worker crashes or broker restarts.

### Decision
1. Topology: Durable topic exchange `mentoring.events`, durable queue `notification.email.queue` with binding `booking.*`.
2. Dead-lettering: `notification.email.queue.dlx` (Direct) routing to `notification.email.queue.dlq` on message reject/NACK.
3. Consumer mechanics: Bounded `prefetch: 10` with **manual acknowledgments (`autoAck: false`)**.
4. Self-contained payloads: Event payloads embed recipient names, emails, start/end timestamps, and IANA timezone strings.

### Why
- **At-Least-Once Delivery**: Messages remain in RabbitMQ until the worker explicitly executes `channel.ack()`. If a consumer crashes while rendering an email, RabbitMQ detects the closed TCP channel and requeues the message.
- **Zero Database Load on Consumer**: Embedding full snapshots into the event payload allows `apps/notification-worker` to format localized emails in-memory without making any database queries.

### Trade-offs & Guarantees
- **At-Least-Once Delivery Trade-off**: If a consumer crashes *after* sending an email but *before* acknowledging the message to RabbitMQ, the message will be redelivered, potentially sending a duplicate email. This trade-off is consciously accepted over dropped notifications.

### Evidence
- **Topology**: [`packages/rabbitmq/src/index.ts:28-33, 175-215`](file:///Users/mano/workspace/chronus-take-home-task/packages/rabbitmq/src/index.ts#L28-L33).
- **Consumer Implementation**: [`apps/notification-worker/src/index.ts:39-74`](file:///Users/mano/workspace/chronus-take-home-task/apps/notification-worker/src/index.ts#L39-L74), [`apps/notification-worker/src/services/email.service.ts:70-184`](file:///Users/mano/workspace/chronus-take-home-task/apps/notification-worker/src/services/email.service.ts#L70-L184).
- **Plan Reference**: Decisions 7, 39, 40, 45, 61.

---

## 8. Version-Keyed Cache-Aside Availability Caching

### Context
Mentor availability is heavily read-dominant. However, querying slots across multiple date ranges (`today`, `next_7_days`, `next_30_days`, custom bounds) creates dozens of distinct cache keys per mentor. Invalidation using Redis `KEYS` or `SCAN` is $O(N)$ and blocks the single-threaded Redis event loop.

### Decision
Implemented **Version-Keyed Cache-Aside**:
- Base version pointer: `org:{orgId}:mentor:{mentorId}:slots:version` (TTL: 7 days).
- Data payload key: `org:{orgId}:mentor:{mentorId}:slots:v{version}:start:{start}:end:{end}` (TTL: 15 minutes / 900s).
- Invalidation: Mutations execute an atomic `INCR` on the base version key via `redis.pipeline().incr(versionKey).expire(versionKey, 7_DAYS).exec()` with 3-attempt full-jitter exponential backoff.

### Why
- **$O(1)$ Instant Invalidation**: Bumping the version from `v1` to `v2` instantly invalidates all cached date-range payloads for that mentor in a single atomic operation without scanning or deleting individual keys.
- **Fail-Open Availability**: If Redis is offline or partitioned, `getOrInitVersion()` returns `null` and the API queries PostgreSQL directly. The cache is treated strictly as an accelerator, never the source of truth.
- **Custom Range Bypass**: Predefined availability ranges (`today`, `next_7_days`, `next_30_days`, `this_month`) use version-keyed Redis caching. Arbitrary custom date ranges (`startDate` / `endDate`) bypass the cache to avoid unbounded cache-key fragmentation and query PostgreSQL directly.

### Trade-offs
- **Redis Completely Unavailable**: The API catches connection failures, logs a warning, and immediately queries PostgreSQL directly (fail-open), avoiding downtime and preventing stale reads.
- **Transient Version Bump Failure on Mutation**: If Redis is temporarily unreachable during the post-commit `bumpMentorSlotsVersion` call, the version is not incremented. Subsequent reads when Redis recovers can serve the prior version's cached payload for the remainder of its 15-minute TTL. However, PostgreSQL constraints guarantee that double-booking remains strictly rejected (409 Conflict).

### Evidence
- **Implementation**: [`apps/api/src/routes/mentors.ts:19-54, 330-347`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/mentors.ts#L19-L54), [`apps/api/src/routes/bookings.ts:20-42`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/bookings.ts#L20-L42).
- **Automated Test**: [`apps/api/tests/integration/cache.test.ts`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/cache.test.ts).
- **Plan Reference**: Decisions 6, 36, 37, 51, 55, 60.

---

## 9. UTC Storage & Timezone/DST Normalization

### Context
Mentors and members collaborate across different global timezones (e.g., America/New_York, Europe/London, Asia/Kolkata). Storing local wall-clock times introduces ambiguity during Daylight Saving Time (DST) transitions (e.g., clocks falling back an hour).

### Decision
1. **Single Source of Truth**: All slot and booking start/end times are stored strictly in UTC using PostgreSQL `TIMESTAMPTZ(3)`.
2. **Boundary Formatting**: Timezone conversion is treated strictly as a presentation-layer concern. The API and notification workers format times on demand using IANA timezone identifiers via `date-fns-tz` (`formatDateInTimezone`, `formatTimeRangeInTimezone`).

### Why
- **Mathematical Continuity**: Storing UTC eliminates discontinuous jumps during DST shifts.
- **Cross-Timezone Interval Evaluation**: PostgreSQL GiST interval constraints operate accurately in UTC regardless of the viewer's local timezone.

### Evidence
- **Implementation**: [`packages/utils/src/timezone.ts:1-45`](file:///Users/mano/workspace/chronus-take-home-task/packages/utils/src/timezone.ts#L1-L45).
- **Automated Tests**: [`apps/api/tests/integration/timezone.test.ts:1-215`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/timezone.test.ts#L1-L215) verifying US (`EST` $\leftrightarrow$ `EDT`) and UK (`GMT` $\leftrightarrow$ `BST`) transition boundaries.
- **Plan Reference**: Decisions 4, 16, 40.

---

## 10. Multi-Tenant Authorization & DB-Backed Hydration

### Context
In multi-tenant SaaS, tenant data leakage or role spoofing is a critical security vulnerability. If a user's mentor status or organization membership is revoked in PostgreSQL, an unexpired JWT token could still allow unauthorized slot management if the application trusts claims blindly.

### Evolution & Discovery
```
[Initial Approach]
JWT token embedded isMentor claim; requireAuth trusted token payload directly
       │
       ▼
[Security Flaw Discovered]
Privilege Escalation via Stale Claims: If a user was demoted from mentor to member
in the database, their existing 24h JWT token still allowed accessing /mentors/me/slots
       │
       ▼
[Final Decision]
requireAuth verifies cryptographic JWT signature for identity (userId, membershipId),
then queries OrganizationUser in PostgreSQL to hydrate mutable roles (isMentor, timezone)
```

### Decision
1. Strict query scoping: Every database query filters explicitly on `organizationId` from the authenticated session.
2. `requireAuth` queries PostgreSQL to fetch authoritative `OrganizationUser` state on every request, hydrating `req.user.isMentor` and `req.user.timezone` directly from the database.

### Why
- **Instant Revocation**: Role changes and membership deactivations take effect immediately without requiring complex distributed JWT revocation blocklists.
- **Multi-Tenant Scoping**: Prevents cross-tenant parameter tampering by validating path `:orgId` against `req.user.organizationId`.

### Trade-offs
- This adds one indexed lookup per authenticated request, but keeps mutable authorization state authoritative in PostgreSQL and avoids JWT revocation infrastructure.

### Evidence
- **Implementation**: [`apps/api/src/middleware/auth.ts:60-108`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/middleware/auth.ts#L60-L108), [`apps/api/src/middleware/tenant.ts:13-37`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/middleware/tenant.ts#L13-L37).
- **Automated Test**: `"prevents privilege escalation by trusting DB state over stale JWT isMentor claims"` in [`apps/api/tests/integration/mentors.test.ts:190-245`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/mentors.test.ts#L190-L245).
- **Plan Reference**: Decisions 13, 14, 15, 17, 22, 59.

---

## 11. Concurrency-Safe Rescheduling & Cancellation

### Context
Rescheduling an active session requires reserving a new slot, releasing the old slot, and updating the existing booking record in a single operation. If two concurrent reschedule requests race, a naive implementation risks orphaning slots as permanently `BOOKED` or resurrecting cancelled bookings.

### Decision
Executed rescheduling inside an atomic `prisma.$transaction`:
1. Validates current booking `startTime >= NOW()` (past sessions cannot be rescheduled).
2. Reserves target slot: `tx.mentorSlot.update({ where: { id: newSlotId, status: "AVAILABLE" }, data: { status: "BOOKED" } })`.
3. Releases previous slot: `tx.mentorSlot.update({ where: { id: booking.slotId, status: "BOOKED" }, data: { status: "AVAILABLE" } })`.
4. Updates `Booking` asserting existing slot identity:
   ```typescript
   await tx.booking.update({
     where: {
       id: bookingId,
       organizationId,
       slotId: booking.slotId, // 👈 Optimistic predicate
       status: "ACTIVE",
     },
     data: {
       slotId: newSlotId,
       slotStartTime: newSlot.startTime,
       slotEndTime: newSlot.endTime,
     },
   });
   ```

### Why
- **Slot Orphaning Prevention**: If Request 1 and Request 2 concurrently attempt to reschedule the same booking to two different slots, Request 1 updates `slotId = Slot A`. When Request 2 executes Step 4 with `where: { slotId: Slot X }`, it matches 0 rows. Prisma throws `P2025`, causing PostgreSQL to abort and roll back the entire transaction, releasing Request 2's temporary hold on `Slot B`.
- **Identity Preservation**: The original `Booking.id` is preserved across reschedules for historical auditability.

### Evidence
- **Implementation**: [`apps/api/src/routes/bookings.ts:554-830`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/src/routes/bookings.ts#L554-L830).
- **Automated Tests**: `"prevents concurrent reschedule requests from orphaning slots"` in [`apps/api/tests/integration/bookings.test.ts:1407-1475`](file:///Users/mano/workspace/chronus-take-home-task/apps/api/tests/integration/bookings.test.ts#L1407-L1475).
- **Plan Reference**: Decisions 26, 27, 65, 66.

---

## 12. Modular Monorepo & Process Boundaries

### Context
Structuring multiple applications (Web SPA, REST API, Publisher Worker, Notification Worker) and shared domain logic without creating monolithic coupling or premature microservice complexity.

### Decision
Implemented a **Turborepo Monorepo** with discrete packages:
- Applications: `apps/web`, `apps/api`, `apps/event-publisher-worker`, `apps/notification-worker`.
- Shared Packages: `@chronus/db`, `@chronus/redis`, `@chronus/rabbitmq`, `@chronus/logger`, `@chronus/utils`, `@chronus/ui`.

### Why
- **Decoupled Failure Domains**: An outbox worker failure or RabbitMQ reconnect loop does not impact the Express HTTP server's ability to serve synchronous API requests.
- **End-to-End Type Safety**: Shared TypeScript interfaces eliminate schema drift between frontend and backend without publishing private npm packages.
- **Optimized Docker Builds**: Dockerfiles utilize `turbo prune` to build minimal, highly cached Alpine runner images.

### Evidence
- **Monorepo Config**: [`turbo.json`](file:///Users/mano/workspace/chronus-take-home-task/turbo.json), [`docker-compose.yml`](file:///Users/mano/workspace/chronus-take-home-task/docker-compose.yml).
- **Plan Reference**: Decisions 9, 10, 11, 12, 42, 43, 56.

---

## 13. Intentional Scope & Trade-offs

| Feature Area | What Was Chosen | Stated Engineering Rationale |
| :--- | :--- | :--- |
| **Authentication** | Header-based multi-tenant user switcher with signed JWT session cookies. | Focused development effort on concurrency safety and transactional correctness rather than OAuth/SAML integration. |
| **User / Org Onboarding** | Pre-seeded multi-tenant fixtures (`pnpm db:seed`). | Satisfies multi-tenant evaluation requirements while avoiding superficial CRUD surface. |
| **Mentor Availability UI** | Seeded slots across mentors and global timezones. | Concentrated full bandwidth on mentee booking safety, double-booking contention, and reschedule correctness. |
| **Email Transport** | Structured console logging inside `notification-worker`. | Avoids external API dependencies and API keys while proving the end-to-end asynchronous messaging pipeline. |
| **API Rate Limiting** | 10KB body size limits and database-level exclusion constraints. | Deferred application-level token bucket rate limiters in favor of core transactional integrity. |
| **Outbox Compaction** | Retaining historical `PUBLISHED` outbox events in PostgreSQL. | For evaluation workloads, row accumulation does not degrade query performance under indexed `status` filters. |

---

## 14. What I Would Change for Production

1. **Outbox Partitioning & Archival Routine**:
   - *Production Need*: High transaction volume will bloat the `OutboxEvent` table over time.
   - *Change*: Implement daily PostgreSQL range partitioning on `createdAt` and a background worker to drop or archive partitions older than 7 days to S3/Cold storage.
2. **Outbox-Driven Asynchronous Cache Reconciliation**:
   - *Production Need*: If Redis is offline during a booking mutation, inline cache version bumping fails.
   - *Change*: Have the outbox worker trigger Redis version bumps asynchronously upon dispatching `BOOKING_*` events, guaranteeing eventual cache consistency even after prolonged cache partitions.
3. **OpenTelemetry Distributed Tracing**:
   - *Production Need*: Visualizing latency bottlenecks and trace spans across HTTP handlers, outbox pollers, and RabbitMQ consumers.
   - *Change*: Export `AsyncLocalStorage` correlation contexts to OpenTelemetry collectors (Grafana Alloy / Tempo).
4. **Consumer Message Deduplication Cache**:
   - *Production Need*: At-least-once delivery can cause rare duplicate emails if a consumer crashes post-dispatch before ACK.
   - *Change*: Store processed event IDs in Redis with a 24-hour TTL in the notification worker before invoking email dispatchers.
5. **Connection Pooling via PgBouncer**:
   - *Production Need*: High horizontal API replica counts can exhaust PostgreSQL connection limits.
   - *Change*: Deploy PgBouncer in transaction-pooling mode between Express API instances and PostgreSQL.
6. **Mentor Recurring Availability Rule Engine**:
   - *Production Need*: Mentors need to define weekly recurring schedules (e.g., "Every Tuesday 2–4 PM") rather than generating one-off slots.
   - *Change*: Build a recurrence expansion worker and bidirectional calendar synchronization (Google Calendar / Outlook iCal).
