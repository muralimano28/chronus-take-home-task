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
Concurrency/Idempotency strategy:
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