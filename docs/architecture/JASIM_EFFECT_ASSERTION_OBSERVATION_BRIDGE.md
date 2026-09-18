# JASIM — EFFECT ASSERTION → CANONICAL OBSERVATION BRIDGE

**Module:** `api/runtime/effect-observation-bridge.ts`
**New tables:** 0 · **New freshness mechanism:** 0 · **Client endpoint:** none yet

```
REAL SIGNAL → VALIDATED ASSERTION → CANONICAL OBSERVATION → FRESHNESS
            → COMPLETION POLICY → VERIFICATION
```

---

## 1. THE GAP, PROVEN BEFORE IT WAS FILLED

`CompletionPolicy` could **require** an independent readback, and nothing could
**produce** one. Traced:

| Side | Finding |
|---|---|
| `completion-policy.ts` | **zero** references to observations |
| Registered resolvers | exactly one — `notify`, reading `notification_intents`, a ledger of JASIM's own dispatch rather than an observation of the world |
| `block2/observations.ts` | `recordObservation` has no production caller outside its own module |
| `block31/observations.ts` | a **second** observation system, with a `proofClass` vocabulary, also unreachable from verification |

The policy's strongest evidence class was a socket with nothing plugged in.

---

## 2. THE TWO STAGES THAT MUST NOT COLLAPSE

```
PROVIDER CLAIM        != CANONICAL OBSERVATION
CANONICAL OBSERVATION != VERIFIED EFFECT
```

A provider may assert "state = OPEN". Three separate decisions follow, with
three separate owners:

1. **May this become an Observation, and with what trust class?** — the bridge.
2. **Is it still current?** — the existing freshness model.
3. **Is it enough to verify the effect?** — `CompletionPolicy`.

This module makes only the first.

---

## 3. THE RULE THAT MAKES IT SAFE

> **A signal's trust class is decided by HOW IT ARRIVED, never by what it says.**

`submitEffectSignal` takes a `channel` — the trusted call site's account of the
transport — and derives the claim source from a frozen table:

| Channel | Claim source | Proof class |
|---|---|---|
| `PROVIDER_RESPONSE` | `SELF_REPORTED` | `self_report` |
| `HUMAN_PROVIDER_REPORT` | `SELF_REPORTED` | `self_report` |
| `AUTHENTICATED_TELEMETRY` | `INDEPENDENT_READBACK` | `authenticated_webhook` |
| `RUNTIME_READBACK` | `INDEPENDENT_READBACK` | `signed_proof` |
| `INTERNAL_STATE_READBACK` | `INTERNAL_READBACK` | `signed_proof` |
| `OWNER_CONFIRMATION` | `OWNER_CONFIRMATION` | `counterparty_confirm` |

Two properties of this table matter more than its contents:

- **No channel yields `BOUND_PROVIDER_RECEIPT` or `EXECUTOR_RETURN`.** Those are
  established by a signature check and by a function returning — neither is
  something an observation can assert into being.
- **A party's own word maps to `SELF_REPORTED`**, which no effectful policy
  accepts. So a provider's HTTP 200 can become a perfectly real Observation and
  still verify nothing.

A payload containing `trustLevel`, `verified`, `independent`,
`providerVerified`, `effectVerified`, `proofClass`, `claimSource` or `source` is
**rejected outright** — not stripped and used. Both `payload` and `provenance`
are screened.

---

## 4. WHY BLOCK 2's `observations` TABLE

Two observation systems existed. The choice was forced by two of the brief's own
constraints:

- **Part 7 forbids a second freshness mechanism**, and `observations` is the
  only table carrying `freshnessExpiresAt`.
- **Part 17 requires the same canonical truth to serve verification and
  generative UI**, and `observations` is what the Presentation pipeline already
  reads through track sessions.

`fulfillment_observations` contributed its `PROOF_CLASSES` vocabulary, which is
**reused** in `sourceKind` rather than replaced. No parallel trust system was
invented.

---

## 5. ATTEMPT BINDING — NO NEW COLUMN

Evidence must be attributable to the effect it is about. The `observations`
table has no `attemptId` column, and `provenance` is exactly the field for
operational lineage, so the binding is written there:

```ts
provenance: { channel, claimSource, attemptId, runId, nodeId, receivedAt }
```

`submitEffectSignal` validates that the attempt **exists and belongs to this
owner** before any row is written — so a raw attempt id from another owner is
*not found* rather than merely refused, because a raw id is not authority.

`observationEvidence` then counts only rows whose provenance names **this**
attempt. That is what closes replay: evidence for one attempt is not evidence
for another, even with the same owner, subject and value.

---

## 6. THE READING RULES, IN ORDER

`observationEvidence` applies three rules, and the order is the design:

1. **Attempt binding.** Unbound rows are invisible.
2. **Freshness.** An expired row, or one older than the policy's own `maxAgeMs`,
   is not current evidence — a device that was OPEN thirty minutes ago says
   nothing to a policy needing thirty seconds. Both the row's own horizon and a
   caller-supplied ceiling apply, and the row's horizon is the *existing*
   `freshnessExpiresAt`.
3. **Conflict.** Two fresh observations that disagree produce `UNCERTAIN`,
   which `decideCompletion` turns into `INCONCLUSIVE`.

Only after all three does the strongest surviving source win, ranked
`OWNER_CONFIRMATION` → `INDEPENDENT_READBACK` → `INTERNAL_READBACK` → … .

### Conflict is not a tie-break

Provider says PRESENT; independent telemetry says ABSENT. The bridge does **not**
prefer the stronger source and move on. Both readings are preserved in
`considered`, and the verdict is uncertainty — because **two authorities
disagreeing is a stronger signal than one being unsure**, and silently choosing
the convenient one is how a false success is manufactured.

---

## 7. THE DISTINCTIONS, CONCRETELY

| Case | What the bridge does |
|---|---|
| Command receipt vs state | different `observationType`. An acknowledgement of OPEN is not an observation of OPEN, so a state query finds nothing |
| SENT vs DELIVERED | different `observationType`. Delivery is never inferred; a policy asking for it finds no evidence and stays PENDING |
| POST 200 vs resource exists | `PROVIDER_RESPONSE` → SELF_REPORTED → PENDING. A separate `RUNTIME_READBACK` → INDEPENDENT_READBACK → VERIFIED |
| Human report vs owner confirmation | `HUMAN_PROVIDER_REPORT` → SELF_REPORTED → PENDING. `OWNER_CONFIRMATION` → VERIFIED |
| Compensation readback | the same bridge, with `occurredWhen` inverted to mean absence. **No separate compensation observation infrastructure** |

---

## 8. DEDUPLICATION — AND WHY NOT

An observation is an **append-only fact**. A repeated reading is not a lie, and
time, source and version still matter — so duplicate callbacks are stored, not
dropped.

What the bridge prevents is not duplicate rows but **pathological repeated
state**: agreement is not conflict, so two identical readings leave the verdict
exactly where one did. The existing `observations` identity (`obs_` + uuid,
ordered by `observedAt`) is reused; nothing new was added.

---

## 9. PRESENTATION — ONE TRUTH, TWO CONSUMERS

A row produced by `submitEffectSignal` flows unchanged through
`openTrackSession → attachObservationToTrack → projectTrackForViewer`. Fresh
rows project FRESH; stale rows keep stale semantics.

And the provenance the bridge added — `attemptId`, `runId`, `nodeId` — does
**not** reach the viewer: the existing projection emits only a freshness
annotation, and that is asserted, because this phase put new fields there.

---

## 10. NO CLIENT AUTHORITY, AND NO CLIENT PATH YET

The bridge is **not exposed through any registered router**. That is its current
state, asserted deliberately so that adding an endpoint becomes a visible
decision.

When one is added, the rule is already structural: the endpoint supplies the
`channel` from what it knows about the caller — an authenticated owner session
yields `OWNER_CONFIRMATION`, a verified webhook signature yields
`AUTHENTICATED_TELEMETRY` — and the body never names its own trust.

END.
