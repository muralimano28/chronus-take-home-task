Future work:
- Add indexes based on actual queries

Today's plan:
- Write tests for the api endpoints [Done]
- Tests from checks and tests based on scenario [Done]
- Write integration tests [Done]

- Implement cancel and reschedule endpoints

- Start front-end implementation
- Consider Redis caching for availability
- Background jobs for sending notification
- Worker for sending notification
- Add Winston for logging and ELK for checking logs
- Add correlation-id for traceability

Tests:
tenant isolation [Done]
concurrent booking  [Done]
idempotency + concurrent idempotency test [Done]
cancellation
rescheduling
timezone conversion