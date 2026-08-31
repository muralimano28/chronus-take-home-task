# Chronus Integration & Verification Test Suite

This document indexes the platform's core automated integration tests across all subsystems. Each entry details the engineering invariant verified, the exact source code location (clickable on GitHub and in IDEs), and the precise CLI command to execute the test against the live test database (`localhost:5432`) and Redis (`localhost:6379`).

---

## 1. Concurrency & Slot Contention

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Slot Double-Booking Race** | Fires concurrent requests at the exact same millisecond for the same slot. Verifies exactly one succeeds (`201 Created`), the second fails (`409 Conflict`), and only 1 active booking exists in DB. | [`bookings.test.ts:11`](../apps/api/tests/integration/bookings.test.ts#L11) | `pnpm --filter api test -t "allows only one user to book a slot concurrently"` |
| **Member Overlap TOCTOU Race** | Fires concurrent requests from the same member for two distinct overlapping slots. Verifies the PostgreSQL GiST exclusion constraint (`no_overlapping_active_member_bookings`) rejects the overlap atomically (`409 Conflict`). | [`bookings.test.ts:89`](../apps/api/tests/integration/bookings.test.ts#L89) | `pnpm --filter api test -t "prevents concurrent member overlap race condition"` |
| **Cross-Mentor Active Overlap** | Validates that a member cannot book a slot if they already have an active booking overlapping in time with a different mentor. | [`bookings.test.ts:594`](../apps/api/tests/integration/bookings.test.ts#L594) | `pnpm --filter api test -t "rejects booking a slot if the member already has an active booking"` |
| **Unavailable Slot Booking** | Rejects booking attempts on slots marked `BOOKED` with `409 Conflict`. | [`bookings.test.ts:741`](../apps/api/tests/integration/bookings.test.ts#L741) | `pnpm --filter api test -t "Cannot book unavailable slot"` |
| **Past Slot Rejection** | Rejects booking attempts on historical slots (`startTime < NOW()`) with `400 Bad Request`. | [`bookings.test.ts:785`](../apps/api/tests/integration/bookings.test.ts#L785) | `pnpm --filter api test -t "Cannot book slot in the past"` |

---

## 2. Idempotency & Replay Protection

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Deterministic Replay** | Verifies retrying a completed request returns `200 OK` with the original cached response body and `x-idempotent-replayed: true` header. | [`bookings.test.ts:173`](../apps/api/tests/integration/bookings.test.ts#L173) | `pnpm --filter api test -t "returns the existing booking when the same idempotency key is retried"` |
| **Canonical JSON Key Sorting** | Verifies that payloads with identical data but different JSON field ordering produce identical SHA-256 hashes and replay cleanly without 400 errors. | [`bookings.test.ts:231`](../apps/api/tests/integration/bookings.test.ts#L231) | `pnpm --filter api test -t "handles idempotent retries with different object key ordering"` |
| **Cross-User Key Isolation** | Verifies that two distinct members sending the identical `Idempotency-Key` operate in isolated keyspaces; Member B never receives Member A's cached booking response. | [`bookings.test.ts:278`](../apps/api/tests/integration/bookings.test.ts#L278) | `pnpm --filter api test -t "prevents cross-user idempotency key collisions"` |
| **Payload Mismatch Detection** | Retrying an existing idempotency key with a mutated payload (e.g. different `slotId`) is immediately rejected with `400 Bad Request`. | [`bookings.test.ts:329`](../apps/api/tests/integration/bookings.test.ts#L329) | `pnpm --filter api test -t "rejects request if the same idempotency key is retried with a different slotId"` |
| **30s Lease Reclamation** | Verifies that a stalled/crashed key in `STARTED` state older than 30s is safely reclaimed by a subsequent retry and executed to completion. | [`bookings.test.ts:386`](../apps/api/tests/integration/bookings.test.ts#L386) | `pnpm --filter api test -t "reclaims an idempotency key lock if the lease window has expired"` |
| **Concurrent Same-Key Race** | Simultaneous requests with the identical key coordinate safely: exactly one proceeds while the other receives `409 Conflict: Request in progress`. | [`bookings.test.ts:450`](../apps/api/tests/integration/bookings.test.ts#L450) | `pnpm --filter api test -t "handles concurrent requests with the same idempotency key"` |
| **Concurrent FAILED-Key Reclaim** | Concurrent retries racing to reclaim a `FAILED` key coordinate safely via atomic `updateMany` without creating duplicate records. | [`bookings.test.ts:503`](../apps/api/tests/integration/bookings.test.ts#L503) | `pnpm --filter api test -t "safely handles concurrent retries racing to reclaim a FAILED idempotency key"` |

---

## 3. Cancellation & Rescheduling Safety

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Atomic Cancellation** | Cancels an active booking, transitions booking to `CANCELLED`, frees slot to `AVAILABLE`, and records an outbox cancellation event. | [`bookings.test.ts:955`](../apps/api/tests/integration/bookings.test.ts#L955) | `pnpm --filter api test -t "allows a member to cancel their own active booking"` |
| **Cross-Member Cancellation Denial** | Rejects cancellation attempts if the target booking belongs to another member (`403 Forbidden`). | [`bookings.test.ts:1013`](../apps/api/tests/integration/bookings.test.ts#L1013) | `pnpm --filter api test -t "rejects cancellation if the booking belongs to another member"` |
| **Idempotent Cancellation** | Cancelling an already-cancelled booking returns `200 OK` with the cancelled status without modifying slot state. | [`bookings.test.ts:1072`](../apps/api/tests/integration/bookings.test.ts#L1072) | `pnpm --filter api test -t "allows idempotent cancellations"` |
| **Re-Booked Slot Cancellation Defense** | If Slot X is freed and re-booked by Member B, an in-flight delayed cancellation retry for Booking 1 will NOT corrupt Member B's slot. | [`bookings.test.ts:1119`](../apps/api/tests/integration/bookings.test.ts#L1119) | `pnpm --filter api test -t "ensures cancellation retry after slot is re-booked by another member does NOT corrupt"` |
| **Partial Unique Index Re-Booking** | Verifies that a previously cancelled slot can be booked again, maintaining 1 `CANCELLED` record and 1 `ACTIVE` record under the partial index. | [`bookings.test.ts:1255`](../apps/api/tests/integration/bookings.test.ts#L1255) | `pnpm --filter api test -t "allows a member to book a slot that was previously cancelled"` |
| **Booking ID Preservation on Reschedule** | Rescheduling updates `slotId` in place, preserves the original `Booking.id`, frees the old slot, and reserves the new slot. | [`bookings.test.ts:1333`](../apps/api/tests/integration/bookings.test.ts#L1333) | `pnpm --filter api test -t "allows a member to reschedule an active booking to another available slot"` |
| **Concurrent Reschedule Slot-Orphaning Defense** | If two concurrent requests try to reschedule Booking 1 to Slot B and Slot C, only one commits; the second fails on `slotId` mismatch and rolls back without orphaning Slot C. | [`bookings.test.ts:1407`](../apps/api/tests/integration/bookings.test.ts#L1407) | `pnpm --filter api test -t "prevents concurrent reschedule requests from orphaning slots"` |
| **Past Booking Reschedule Rejection** | Rejects rescheduling if the current slot is in the past (`400 Bad Request`). | [`bookings.test.ts:1494`](../apps/api/tests/integration/bookings.test.ts#L1494) | `pnpm --filter api test -t "rejects rescheduling a booking if the current slot is in the past"` |
| **Reschedule Member Overlap Defense** | Rejects rescheduling if the new target slot overlaps in time with another active booking held by the same member. | [`bookings.test.ts:1674`](../apps/api/tests/integration/bookings.test.ts#L1674) | `pnpm --filter api test -t "rejects reschedule if it causes overlapping active bookings for the member"` |
| **Idempotent Reschedule Replay** | Retrying a reschedule request with the same idempotency key returns `200 OK` and the replayed reschedule response. | [`bookings.test.ts:1824`](../apps/api/tests/integration/bookings.test.ts#L1824) | `pnpm --filter api test -t "returns the replayed reschedule booking response when retried with the same key"` |

---

## 4. Multi-Tenancy & Authorization Security

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Cross-Tenant Mentor Isolation** | Querying `/mentors` strictly filters by the authenticated user's `organizationId`, preventing cross-tenant data exposure. | [`mentors.test.ts:11`](../apps/api/tests/integration/mentors.test.ts#L11) | `pnpm --filter api test -t "does not expose mentors from another organization"` |
| **Cross-Tenant Token Rejection** | `requireAuth` validates cryptographic signature and verifies that the membership belongs to the claimed organization (`401 Unauthorized`). | [`mentors.test.ts:134`](../apps/api/tests/integration/mentors.test.ts#L134) | `pnpm --filter api test -t "rejects a token whose membership does not belong to the claimed organization"` |
| **Privilege Escalation Defense** | Stale JWT tokens containing `isMentor: true` are overridden by querying the authoritative `OrganizationUser` record in PostgreSQL. | [`mentors.test.ts:335`](../apps/api/tests/integration/mentors.test.ts#L335) | `pnpm --filter api test -t "prevents privilege escalation by trusting DB state over stale JWT"` |
| **Mentor Self-Booking Prevention** | Rejects booking attempts when a mentor tries to book their own slot (`400 Bad Request`). | [`bookings.test.ts:709`](../apps/api/tests/integration/bookings.test.ts#L709) | `pnpm --filter api test -t "Mentor cannot book own slot"` |
| **Cross-Tenant Booking Denial** | Rejects booking attempts on slots belonging to a different organization (`404 Not Found`). | [`bookings.test.ts:829`](../apps/api/tests/integration/bookings.test.ts#L829) | `pnpm --filter api test -t "Cannot book slot belonging to another organization"` |
| **Cross-Tenant Listing Isolation** | Organization A members cannot view Organization B booking records in `GET /bookings`. | [`bookings.test.ts:882`](../apps/api/tests/integration/bookings.test.ts#L882) | `pnpm --filter api test -t "Organization A cannot see Organization B bookings"` |

---

## 5. Timezones & Daylight Saving Time (DST)

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **US DST Boundary Transition** | Verifies UTC storage and accurate local time conversion across US Eastern Standard Time (`EST`) and Daylight Time (`EDT`) transitions. | [`timezone.test.ts:10`](../apps/api/tests/integration/timezone.test.ts#L10) | `pnpm --filter api test -t "stores and queries slots accurately in UTC across US DST transitions"` |
| **UK DST Transition Safety** | Verifies slot creation and booking across the UK `GMT` $\leftrightarrow$ `BST` clock shifts without timezone drift. | [`timezone.test.ts:87`](../apps/api/tests/integration/timezone.test.ts#L87) | `pnpm --filter api test -t "handles UK DST transition"` |
| **Cross-Timezone Interval Evaluation** | PostgreSQL GiST exclusion correctly identifies interval collisions when members in Tokyo (`Asia/Tokyo`) and New York (`America/New_York`) book overlapping UTC slots. | [`timezone.test.ts:160`](../apps/api/tests/integration/timezone.test.ts#L160) | `pnpm --filter api test -t "detects cross-timezone member overlapping slots accurately"` |

---

## 6. Redis Caching & Invalidation

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Cache-Aside Read Serving** | Subsequent `GET /mentors` queries read from Redis cache without hitting PostgreSQL queries. | [`cache.test.ts:19`](../apps/api/tests/integration/cache.test.ts#L19) | `pnpm --filter api test -t "serves mentor list from Redis cache on subsequent requests"` |
| **Atomic Version Invalidation** | Creating a booking triggers an atomic `INCR` on the mentor's slot version key, invalidating cached slot availability in $O(1)$ time. | [`cache.test.ts:64`](../apps/api/tests/integration/cache.test.ts#L64) | `pnpm --filter api test -t "invalidates mentor slots cache when a booking is created"` |
| **Multi-Mentor Reschedule Invalidation** | Rescheduling invalidates both the previous mentor's slot cache version and the new mentor's slot cache version. | [`cache.test.ts:124`](../apps/api/tests/integration/cache.test.ts#L124) | `pnpm --filter api test -t "invalidates both old and new mentor slots when a booking is rescheduled"` |

---

## 7. Transactional Outbox Worker & Lease Recovery

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Disjoint Concurrent Claiming** | Two outbox publisher workers polling concurrently using `FOR UPDATE SKIP LOCKED` claim completely disjoint batches with zero duplicate event claims. | [`outbox.test.ts:8`](../apps/event-publisher-worker/tests/outbox.test.ts#L8) | `pnpm --filter event-publisher-worker test -t "ensures concurrent worker replicas claim completely disjoint"` |
| **Expired Visibility Lease Recovery** | If a worker crashes while events are in `PROCESSING` state, subsequent worker cycles reclaim the rows once `lockedAt < NOW() - 60s`. | [`outbox.test.ts:66`](../apps/event-publisher-worker/tests/outbox.test.ts#L66) | `pnpm --filter event-publisher-worker test -t "re-claims and recovers events if the worker crashed"` |
| **Active Visibility Lease Protection** | Verifies that worker replicas do NOT reclaim rows that are actively being processed within their 60-second lease window. | [`outbox.test.ts:98`](../apps/event-publisher-worker/tests/outbox.test.ts#L98) | `pnpm --filter event-publisher-worker test -t "does not reclaim an active lease before VISIBILITY_TIMEOUT_SECONDS"` |

---

## 8. Infrastructure Diagnostics

| Test Scenario / Invariant | What It Tests | Test Location (GitHub Link) | Execution Command |
| :--- | :--- | :--- | :--- |
| **Health Check & Dependency Readiness** | `/api/v1/health` verifies active connectivity to both PostgreSQL and Redis and returns `200 OK` with detailed status breakdown. | [`health.test.ts:7`](../apps/api/tests/integration/health.test.ts#L7) | `pnpm --filter api test tests/integration/health.test.ts` |
| **Database Connection Ping** | Verifies raw connection handshake and SQL query execution against `chronus_test_db`. | [`database.test.ts:5`](../apps/api/tests/integration/database.test.ts#L5) | `pnpm --filter api test tests/integration/database.test.ts` |

---

## Batch Test Execution Commands

```bash
# Run all 48 integration tests across the entire monorepo
pnpm test

# Run all 45 API integration tests
pnpm --filter api test

# Run all 3 Outbox Publisher Worker tests
pnpm --filter event-publisher-worker test
```