---
name: Generated execution safety
description: Safety boundary for capabilities that run generated JASIM plans.
---

Generated plans may select only server-created, task-step capability bindings tied to an unchanged plan fingerprint. The currently supported capability set must remain side-effect-free.

**Why:** A model-produced capability name is untrusted. A completed checkpoint cannot make an external side effect crash-safe unless the downstream effect has durable idempotency and reconciliation.

**How to apply:** Bind capabilities when persisting a plan, validate the binding and recorded approval before execution, and record authorization plus outcomes. Add payment, communication, destructive, or external mutation capabilities only with a durable external-action ledger and reconciliation design.

Controlled effect recovery is permitted only in an explicitly injected test registry. Its provider-side result must use the same canonical envelope as normal execution and be keyed by the stable idempotency key; reconciliation must resolve occurrence or absence before any retry.

**Why:** A local harness is useful for proving crash recovery without paying or contacting a real provider, but a raw test adapter or blind retry would invalidate the kernel trust proof.

**How to apply:** Keep test-only capabilities out of the production singleton and routers, inject them only into canonical proposal/DAG tests, preserve the RUNNING attempt across the simulated crash, and use provider readback to drive the existing complete/fail fencing paths.