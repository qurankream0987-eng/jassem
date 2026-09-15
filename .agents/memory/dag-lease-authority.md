---
name: Durable DAG lease authority
description: The durable DAG worker lease rule and why it uses database time for final writes.
---

Any state-changing write by a claimed DAG worker must condition on its credentials, fence version,
row version, and an unexpired lease evaluated by PostgreSQL's current clock.

**Why:** An application-side timestamp can become stale while a request waits on a row lock or
performs gate validation. Without an authoritative final check, a former worker could renew or
change a lease after expiry, defeating recovery fencing.

**How to apply:** Keep the database-time expiry predicate on heartbeat, start, completion,
failure, and gate-denial transitions. Treat a zero-row conditional update as stale-worker
rejection, never as a successful no-op.