---
name: record-decision
description: >-
  Use this skill to record any important design or architectural decisions made during the project.
  Activate this skill whenever a design or architectural decision is reached, to append it to the project's planning or design document (e.g., PLAN.md).
---

# Record Design Decision

This skill guides the agent to document design decisions in the project's primary planning/design document (usually [PLAN.md](file:///Users/mano/workspace/chronus-take-home-task/PLAN.md)).

## Instructions

Whenever an important decision is made (e.g. database choice, concurrency strategy, auth strategy, etc.):

1. Open the primary planning or design document (e.g., [PLAN.md](file:///Users/mano/workspace/chronus-take-home-task/PLAN.md)).
2. Find the end of the file or the dedicated "Design Decisions" section.
3. Check the last recorded Decision number. If none exist, start with `Decision 1`. Otherwise, increment the number.
4. Format the new decision exactly as follows, leaving a blank line before it:

```markdown
Decision {No} — <Short description about the decision>
Why: <Detailed explanation why we took this decision>
```

5. Append this formatted decision to the file.

## Examples

```markdown
Decision 1 — PostgreSQL over NoSQL
Why: Booking is transactional and relational.

Decision 2 — Database-enforced uniqueness
Why: Application-level checks are insufficient under concurrency.
```
