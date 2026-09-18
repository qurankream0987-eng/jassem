# JASIM — EFFECT OBSERVATION BRIDGE REPORT

**Baseline:** `0671d7f` · **Provider:** none · **New tables:** 0 · **Migrations:** 0

---

## 1. THE GAP, PROVEN FIRST

`CompletionPolicy` could require an independent readback and nothing could
produce one.

| Side | Finding |
|---|---|
| `completion-policy.ts` | **zero** references to observations |
| Registered resolvers | one — `notify`, reading a **ledger of JASIM's own dispatch**, not an observation of the world |
| `block2/observations.ts` | no production caller outside its own module |
| `block31/observations.ts` | a **second** observation system with a `proofClass` vocabulary, also unreachable |

Two observation systems, zero bridges. The policy's strongest evidence class was
a socket with nothing plugged in.

---

## 2. WHAT WAS BUILT

`api/runtime/effect-observation-bridge.ts` — one module, no schema change.

- **`submitEffectSignal`** — validates a real signal and records a canonical
  Observation, with the trust class decided by the runtime.
- **`observationEvidence`** — reads bound, fresh, non-conflicting observations
  back as one `EffectAssertion`.
- **`observationEffectResolver`** — adapts that into the `EffectResolver` shape
  the completion policy already consumes.

### The rule that makes it safe

> **A signal's trust class is decided by how it arrived, never by what it says.**

Six channels map through a **frozen** table to claim sources. Two properties of
that table matter more than its contents:

- **No channel yields `BOUND_PROVIDER_RECEIPT` or `EXECUTOR_RETURN`** — those
  are established by a signature check and by a function returning, neither of
  which an observation can assert into being.
- **A party's own word maps to `SELF_REPORTED`**, which no effectful policy
  accepts. A provider's HTTP 200 becomes a real Observation and verifies nothing.

Payloads naming `trustLevel`, `verified`, `independent`, `providerVerified`,
`effectVerified`, `proofClass`, `claimSource` or `source` are **rejected**, not
stripped — in both `payload` and `provenance`.

---

## 3. THREE DECISIONS WORTH DEFENDING

**Block 2's `observations`, not a private evidence table.** Forced by two
constraints: Part 7 forbids a second freshness mechanism and `observations` is
the only table with `freshnessExpiresAt`; Part 17 requires one canonical truth
for verification *and* generative UI, and that is the table Presentation reads.
Block 3.1's `PROOF_CLASSES` vocabulary was reused in `sourceKind` rather than
replaced.

**Attempt binding in `provenance`, not a new column.** No migration. The attempt
is validated owner-scoped **before** any row is written, so a foreign attempt id
is *not found* rather than refused — a raw id is not authority — and nothing is
persisted for a rejected injection.

**Conflict is not a tie-break.** Disagreeing fresh observations produce
`UNCERTAIN`, and both readings are preserved. Preferring the stronger source and
moving on would be exactly how a false success gets manufactured.

---

## 4. EVIDENCE

34 new assertions: 18 behavioural against a real database, 3 presentation,
13 structural.

Cases B-01…B-12 all PASS. The four that carry the most weight:

- **B-04** — a *real* attempt id belonging to another owner is refused and
  **zero rows are written**.
- **B-05** — identical evidence bound to attempt A is invisible to attempt B,
  and still visible to A. The second half proves the row was not merely lost.
- **B-06** — a provider claiming PRESENT against telemetry claiming ABSENT
  yields UNCERTAIN with both readings retained.
- **B-03b** — one row is fresh by its own TTL and stale against a stricter
  policy ceiling. Two ceilings, one mechanism.

Presentation: a bridged row projects FRESH or STALE correctly through the
untouched pipeline, and the provenance this phase added does **not** reach the
viewer — asserted, because new fields went into a structure a viewer-facing
projection reads.

---

## 5. HONEST CLASSIFICATION

```
PROVEN_AT_RUNTIME_CONTRACT_LEVEL  ✔
PROVEN_IN_REAL_WORLD              ✘
```

Every signal comes from a deterministic fixture. There is no real device,
human or messaging provider and none is claimed. What is proven is that when
such a signal arrives, the runtime classifies, binds, ages and adjudicates it
correctly.

---

## 6. WHAT IS DELIBERATELY ABSENT

- **No client submission endpoint.** The bridge is not reachable from any
  registered router, and a test asserts that — so adding one becomes a visible
  decision rather than a quiet widening. When it is added, the endpoint supplies
  the `channel` from what it knows about the caller; the body never names its
  own trust.
- **No capability yet uses `observationEffectResolver`.** The resolver is
  proven; wiring it needs a capability whose effect an external source can
  observe, and none exists.
- **No signature verification on `AUTHENTICATED_TELEMETRY`.** That channel
  assumes the call site already authenticated the sender — documented rather
  than enforced here, because enforcement belongs at the endpoint that does not
  yet exist. **This is the one place where a future mistake would be dangerous**,
  and it is named for that reason.

---

## 7. REGRESSION

| Suite | Result | Δ |
|---|---|---|
| Main | **1359 / 1359** (+8 skipped) | +13 |
| Block 2 | **121 / 121** | — |
| Block 3 | **234 / 234** | +21, and no file under `tests/block3` was touched |
| Block 3.1 | **101 / 101** | +21 |
| `tsc -b` | **PASS** | |
| Web build | **PASS** (5.35s) | |
| Frozen corpus | **unchanged**, digest still pins | |

**No inherited test was modified or weakened.**

On block 3: the count has now read 198, 203, 206, 213 and 234 across five phases
in which nothing under `tests/block3` changed — `git status` confirms it again.
These suites drop and recreate a shared proof database, so collection depends on
its settled state. The number is not a reliable regression signal until they stop
sharing a database. Repeating that each time is more honest than quoting a figure
that looks stable.

---

## 8. NOT BUILT, AS INSTRUCTED

No GoalSpec. No PlanGraph. No replanning. No Real Discovery. No Level 6 or 7.
No redesign of CompletionPolicy, CompensationPolicy, the attempt ledger, the
observation model, freshness, ReferenceBindings, reconciliation or the frozen
benchmark.

END.
