---
name: Block 2 hardening lessons
description: Six trust-boundary invariants the Block 2 code review enforced — apply to any future capability/reservation/remote-execution work in the canonical runtime.
---

Durable lessons from the Block 2 architect review (all now enforced + regression-tested in tests/block2/security-review-fixes.test.ts):

1. **Authorize against server-resolved identity, never caller fields.** When an API accepts a selector (e.g. windowId), resolve the row first and authorize + persist using the ROW's resource identity; reject caller/selector mismatches.
   **Why:** a member authorized on resource A could spend resource B's capacity by substituting the selector ID.
   **How to apply:** any primitive taking both an entity id and a resource reference.

2. **Exactly-once continuation = dispatch BEFORE the claim, keyed by the pre-claim count.** The durable queue's idempotency collapses the crash-retry duplicate; claiming first and keying by the new count double-fires after a crash. Advance lifecycle atomically in the claim statement.
   **Why:** crash between dispatch and terminal update is the real-world case, and retry keys must be stable.
   **How to apply:** temporal triggers, and any scan-dispatch-claim loop.

3. **No external effect outside real attempt lineage.** Delivery/execution helpers must reject synthetic attempt contexts (e.g. `job:` prefixes) fail-closed; redelivery jobs carry the originating runId/nodeId/attemptId.
   **Why:** a durable worker calling channel adapters directly recreates the exact bypass the Trusted Executor exists to close.
   **How to apply:** any durable job whose handler performs side effects.

4. **Remote results are VERIFIED only with an authenticated provider receipt** — HMAC-SHA256 over the canonical result digest with the provider's boot-bound `receiptSecret` (catalog ioMetadata only; discovery never sets it). Missing/tampered ⇒ INCONCLUSIVE, completion fails closed. A locally computed digest alone proves only tamper-evidence after receipt, never truth.
   **Why:** provider-controlled content is not self-verifying.
   **How to apply:** MCP/A2A and any future remote provider kind.

5. **Delegation subset checks must cover EVERY axis at both creation and execution time** — capabilities, purpose, resourceScope, monetary, currency, constraints, time, depth; and execution-time revalidation must walk the whole ancestor chain (root revocation blocks leaves).
   **Why:** checking only the leaf or only some axes is silent authority expansion.
   **How to apply:** delegation.ts and any grant-like primitive.

6. **Remote endpoints need a PINNED SSRF guard.** HTTPS-only outside explicit loopback; reject the full non-public IPv4/IPv6 set (incl. ULA, link-local, IPv4-mapped, CGNAT); resolve + validate + PIN in one step — the connection's `lookup` serves only validated addresses (TOCTOU: fetch re-resolves at connect time otherwise); re-validate + pin every redirect hop; production endpoints bound only via the boot-time catalog.
   **Why:** validating DNS answers without pinning the socket still lets a rebinding hostname reach internal/metadata addresses.
   **How to apply:** any client that fetches provider-supplied or catalog-supplied URLs.
