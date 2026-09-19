# JASIM — GOALSPEC

**Status:** IMPLEMENTED (goal only) · **Phase:** S5a, GoalSpec without PlanGraph
**Module:** `api/runtime/goal-spec.ts` · **Tests:** `tests/unit/goal-spec.test.ts` (50)

```text
GOAL = WHAT SHOULD HAPPEN.        PLAN = HOW IT WILL HAPPEN.
```

This phase built the first half and none of the second.

---

## 1. The gap, proven before it was filled

«رتب لي الموضوع بأرخص طريقة لكن لا تتأخر أكثر من يومين» carries two
requirements. The envelope a turn produces had nowhere typed for either:

```ts
EnvelopeExecutionIntent {
  requiredCapabilities: string[]                  // names of things, not requirements
  missingInputs:        string[]
  inputs:               Record<string, unknown>   // free-form; accepts anything
  risk, persistence, effects
}
```

A model may put `{ deadline: "48h" }` in `inputs` and the schema accepts it,
because `inputs` accepts anything. Nothing then reads it:

| Claim | How it is checked |
|---|---|
| No capability contract mentions a deadline or a cost bound | `grep -icE 'cost\|deadline\|budget\|price\|time'` over `inputs.` references in `api/runtime/capability-registry.ts` → **0** |
| The one `{{inputs.constraints}}` in the repository is a prompt template | It lives in `api/core/capability-registry.ts`, which nothing on the runtime path imports — asserted in `tests/unit/goal-spec.test.ts` |
| The intent schema has no `constraints` and no `hardness` | Asserted against the live source in the same test |

So the failure was **silent and complete**: the deadline was heard, stored, and
never consulted. Worse than refusing it, because the person cannot see it was
dropped.

---

## 2. The shape

```ts
GoalSpec {
  version: 1
  outcome:     string                  // what must become true
  constraints: Constraint[]
  preferences: GoalDimension[]         // ordered, most important first
  assumptions: string[]                // inferred, and not said
  unknowns:    string[]                // must be asked before acting
}

Constraint {
  dimension: COST | TIME | QUALITY | RISK | PRIVACY | LOCATION
  operator:  AT_MOST | AT_LEAST | EQUALS | MINIMIZE | MAXIMIZE
  value?:    number | string           // absent for MINIMIZE / MAXIMIZE
  unit?:     string                    // required for a numeric bound
  hardness:  HARD | SOFT
  source:    STATED | INFERRED
  evidence?: string                    // the user's own words
}
```

Six dimensions, frozen. A car, a scaffold and a translator all reduce to them.
A seventh is added only when a requirement genuinely cannot be expressed —
never because a new domain arrived. **A dimension named after a domain would be
the domain branch this architecture refuses.**

### `hardness` is the load-bearing field

HARD is a wall: a result that violates it is **wrong**, not merely worse.
SOFT is a direction: it orders outcomes and never excludes one.

Collapsing the two is exactly how «لا تتأخر أكثر من يومين» becomes
"we tried to be quick".

### `source` is what keeps `hardness` honest

A model reading «رتب لي الموضوع بسرعة» can reasonably infer a deadline. It may
not then present its own inference as the person's wall.

> **An INFERRED constraint is downgraded to SOFT.** Recorded in `adjustments`,
> never silent.

Downgrade rather than reject, for the same reason `applyCompletionDecision`
downgrades: an over-confident inference is an ordinary modelling mistake, and
rejecting a whole goal over one would cost a person their turn. The rule is
**downgrade-only** — nothing in this module can turn a SOFT preference into a
HARD wall.

---

## 3. What the runtime can decide with no plan at all

```ts
GoalReadiness = "ACTIONABLE" | "NEEDS_INPUT" | "UNSATISFIABLE"
```

- **NEEDS_INPUT** — `unknowns` is non-empty. Ask the person.
- **UNSATISFIABLE** — HARD bounds on one dimension cannot all hold. No plan can
  exist, so no plan needs to be attempted.
- **ACTIONABLE** — neither.

`UNSATISFIABLE` wins over `NEEDS_INPUT`. Answering a question cannot make an
impossible goal possible, and sending somebody away to answer one that will not
help is its own small lie.

### Contradiction detection, and its honest limits

Time units normalise against fixed factors, so `2 DAY` and `48 HOUR` agree.
**Every other dimension compares only within one unit** — two costs in different
currencies need a rate, the module has no rate, and inventing one would be an
invented fact. Such a pair is reported as `INCOMPARABLE_HARD_BOUNDS`, not passed
as satisfiable.

The same applies to a unit the module does not recognise. A hard bound that
cannot be placed on a number line is **not one it may ignore** — dropping it
would let a goal pass because one of its requirements was unreadable. (This was
a real bug in the first draft, caught by the test that now guards it.)

Only impossibility is reported. `AT_MOST 5` beside `AT_MOST 3` is redundant, not
contradictory: narrowing a requirement is the person's prerogative.

---

## 4. Authority

Ten keys join the shared `AUTHORITY_KEYS` set and are rejected outright,
including nested inside a constraint:

```
constraintWaived · waiveConstraint · overrideConstraint · ignoreConstraint
hardnessOverride · constraintSatisfied · goalAchieved · goalComplete
budgetApproved · approvedByOwner
```

A model may state what should happen. It may not declare that a requirement has
been waived, met, or approved. The schema is `.strict()` throughout: an
unexpected key is a prompt bug or an injection landing, and both are loud.

---

## 5. GOAL is not PLAN — enforced, not promised

`tests/unit/goal-spec.test.ts` fails if this module ever learns to name a step:

- The source of `evaluateGoalSpec`, `parseProposedGoalSpec` and
  `goalBlockerMessage` may not contain `capability`, `provider`, `dependsOn`,
  `dagNode`, `steps`, `nodeKey`.
- `GoalSpecSchema.shape` is asserted to be exactly the six fields above.
- No dimension may match a domain word.

**No PlanGraph was implemented.** `composeRequirementGraph` is still not called
from the turn path, plan validation does not exist, and nothing was retired.

---

## 6. How it reaches a turn — and what is not yet true

`goalSpec` is an **optional** field on the three execution-intent envelope
kinds (`direct_action`, `workflow`, `durable_run`). One model call, no new
latency, and a model that omits it keeps working exactly as before.

When present it is evaluated immediately and attached to `modelMetadata.goal`:
readiness, hard and soft constraints, adjustments, conflicts, assumptions,
unknowns.

**It is recorded, not enforced.** Two reasons, both deliberate:

1. Deciding what to *do* about an unsatisfiable goal is a decision about how
   work proceeds — plan territory.
2. No provider is configured in this environment
   (`REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`), so **no model has ever produced
   a GoalSpec here**. Gating a live turn on a refusal path nobody has seen fire
   would be shipping an untested block.

What is proven: the type, the validation, the downgrade rule, the contradiction
detection, the authority boundary, the envelope wiring, and that a turn without
a `goalSpec` is unchanged. What is **not** proven: that a real model produces a
well-formed GoalSpec from a real Arabic sentence. That is the first thing to
verify when a provider is configured.
