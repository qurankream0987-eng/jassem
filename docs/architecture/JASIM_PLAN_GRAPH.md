# JASIM — PLANGRAPH

**Status:** IMPLEMENTED (contract, validation, materialization) · **Phase:** S5b
**Module:** `api/runtime/plan-graph.ts`
**Tests:** `tests/unit/plan-graph.test.ts` (82) · `tests/block31/plan-graph-materialization.test.ts` (9) · `tests/evals/plan-graph-evals.test.ts` (16)

```text
GOAL = WHAT SHOULD HAPPEN   (goal-spec.ts)
PLAN = HOW IT SHOULD HAPPEN (plan-graph.ts)
RUN  = IT HAPPENING         (the existing durable DAG — untouched)
```

---

## 1. The gap, proven on the active path

A conversational turn reaches `createExecutionProposalsForIntent`:

```ts
const requestedCapabilities = [...new Set(input.intent.requiredCapabilities)];
const capabilities = requestedCapabilities.length > 0 ? requestedCapabilities : [null];
return Promise.all(capabilities.map((capability) => createExecutionProposal({ ... })));
```

One proposal per capability label, each receiving the **same** `intent.inputs`, and
`dependencies` is never supplied — `createExecutionProposal` reads
`input.dependencies ?? []`, and no caller on the turn path passes it. So every plan
the product built from a conversation was a flat, dependency-free set.

| Finding | Location |
|---|---|
| Flat materialization, dependencies always `[]` | `jasim-runtime.ts` — `createExecutionProposalsForIntent` → `createExecutionProposal` |
| The one dependency-aware graph on the turn path is hardcoded | `createResearchImageComposition`, gated by `isResearchImageCompositionIntent`. Three nodes, real `dependencies`, real `__runtimeBindings` — and it can only ever build that one shape |
| A composer exists and is never called from a turn | `composeRequirementGraph` in `semantic-fabric.ts`, exposed as `fabric.composeGoal` |
| Dead planners, off the active path | `api/core/planner.ts`, `api/core/generated-plan-executor.ts` — nothing outside `api/core` imports either. Asserted in the evals, and not reopened |

**JASIM executed dependency graphs beautifully and could not produce one.**

---

## 2. The contract

```ts
PlanGraph {
  version: 1
  kind:     DAG | MONITORING | PERSISTENT_WORLD | DIRECT_READ | IDENTITY_CHANGE | SETTING_MUTATION
  nodes:    PlanNode[]        // empty for the kinds that are not DAGs
  blockers: string[]          // what the planner could not resolve
}

PlanNode {
  key:          string                 // identity within the plan
  capabilityId: string                 // WHAT, never WHO
  inputs:       Record<string, unknown>
  dependsOn:    string[]
  bindings:     PlanBinding[]          // output → input
  enforces:     number[]               // indices of goal constraints this step owns
  authority:    NONE | OWNER_APPROVAL | BUDGET_AUTHORITY | REAUTHENTICATION
}

PlanBinding { fromNode: string; valuePath: string; targetKey: string }
```

### What was deliberately left out

The brief listed fields a plan node "may need". Each was added only if it changes
runtime behaviour, and four did not:

| Candidate field | Why it is absent |
|---|---|
| `outputs` / `effects` | The capability registry already declares `effectKind`. Re-declaring it would let a plan disagree with the registry about what a step does. |
| `preconditions` | `dependsOn` + `bindings` + `authority` are the preconditions that change behaviour. A fifth notion of "not yet" would be a fourth thing to keep in sync. |
| `providerRequirements` | `CAPABILITY != PROVIDER`. A plan that names a provider has made a resolution decision that belongs later and elsewhere. The schema has **no provider field at all**, which is asserted. |
| `completionRequirements` | `CompletionPolicy` owns this, derived from the capability. A plan may not lower the bar for what counts as done. |
| `maxAttempts` | A first draft carried it, optional and never set. A planner that sets attempt counts is deciding how many times a real-world effect may be attempted — execution wearing a planning hat. The `BLIND_RETRY = 0` eval caught it. |

`compensation` is **read, not declared**: `planCompensationOutlook` derives
reversibility from the capability registry so a person can see it *before*
approving. It requests nothing, performs nothing, verifies nothing —
`COMPENSATION_REQUESTED != EXECUTED != VERIFIED`, and `CompensationPolicy`
remains authoritative once an effect has actually happened.

---

## 3. Not every goal is a DAG

Six kinds, each routing somewhere materially different. **None is a domain.**

| Kind | Why it exists | Example |
|---|---|---|
| `DAG` | steps with dependencies | «رتب لي الموضوع» |
| `MONITORING` | a standing condition that acts only if it becomes true | «راقب السعر وأخبرني إذا انخفض» |
| `PERSISTENT_WORLD` | materialises a durable system | «أنشئ لي نظامًا دائمًا» |
| `DIRECT_READ` | answerable from what the runtime can already read | «كم سعر هذا؟» · «أرني جدول مبيعاتي» · «شغل لي الخريطة» |
| `IDENTITY_CHANGE` | changes **who** the runtime operates as | «سجلني دخول» · «سجلني خروج» |
| `SETTING_MUTATION` | changes a stored preference on the owner's own account | «لا ترسل لي إشعارات في الليل» |

`IDENTITY_CHANGE` is the boundary §15 of the brief protects. Every other
authorization check in the system is evaluated **against** the identity, so a step
that changes it cannot be a step whose result is a receipt. A plan of that kind
carrying DAG nodes is a validation violation, and `materializePlanGraph` returns
`[]` for it. No secure authentication surface was implemented in this phase — only
the boundary that keeps one possible.

«سجلني دخول» and «سجلني خروج» are the **same kind**. «أرني جدول مبيعاتي» and «شغل
لي الخريطة» are the **same kind**. There is no LoginAgent, no MapAgent, no
SalesAgent, and no permanent tab for any of them.

---

## 4. Hard constraints are never silently ignored

Every constraint in the goal receives exactly one disposition:

```
ENFORCED       a named node owns it
UNSATISFIABLE  the goal's own hard bounds collide; no plan can fix that
NEEDS_INPUT    the goal has an open question; this waits on the answer
BLOCKED        nothing in this plan enforces it
```

A **HARD** constraint that reaches `BLOCKED` makes the whole plan `BLOCKED`. A
**SOFT** one does not: nobody ranked by it, which is disappointing rather than
wrong.

Constraints are **not** forced onto every node. Putting a deadline on a read-only
lookup is noise that makes the real owner harder to find. What is enforced is that
every hard requirement has *some* owner.

`UNSATISFIABLE` and `NEEDS_INPUT` stay distinct, because "no plan can exist" is not
"answer this and we will proceed".

---

## 5. Model trust boundary

A model may propose a plan. `parseProposedPlanGraph` validates before anything else
sees it:

- **Schema**, `.strict()` throughout. An unexpected key is rejected, not trimmed.
- **Authority keys** rejected outright, including nested inside a node: nine keys
  mirrored into the shared `AUTHORITY_KEYS` (`planApproved`, `providerTrusted`,
  `skipApproval`, `executionVerified`, …).
- **Capabilities** resolved against the closed trusted registry.
- **Dependencies** must exist, must not be self-referential, must be acyclic.
- **Bindings** must reference a node the binder actually depends on.
- **Constraint indices** must exist in the goal.
- **Authority may be raised, never lowered** — `strongerAuthority` applies the
  registry's floor, so a model marking an external side effect `NONE` does not make
  it need less than it needs.

### The one identity key this boundary declares

`capabilityId` is in `IDENTITY_KEYS` system-wide, correctly: a model naming an id is
usually claiming an identity the server assigns. Here it is the entire content of a
step, so this boundary declares it via `allowKeys` — and that is safe **only**
because validation resolves every id against the closed registry. The model chooses
from a list; it does not mint a name. (`inputs` is declared `freeFormKeys` for the
sanitiser's own documented reason: a plan for somebody whose data contains a field
called `verified` must not be rejected as an authority claim.)

### The model never names a runtime identity

A binding carries `fromNode` (a plan key) and `valuePath`. `sourceNodeId` and
`sourceRunId` are **not fields**, so a proposal carrying one is rejected rather than
trimmed — a model that could supply a run id could point a binding at another
owner's run.

---

## 6. Materialization into the DAG that already exists

`materializePlanGraph` returns plain `RuntimeDagNodeInput`s. `createRuntimeDag` does
what it has always done: topological ordering, cycle rejection, dependency rows,
leases, attempt ledger, idempotency, policy, approval, CompletionPolicy,
verification, compensation. **None of it was modified.**

Proven against a real proof database (`tests/block31/plan-graph-materialization.test.ts`):

```text
     A            A→B, B→C, B→D, C→E, D→E
     ↓            become five real rows in `dag_dependencies`
     B
   ┌─┴─┐          the shipped `driveRunToCompletion` honours every edge
   C   D
   └─┬─┘          a binding moves A's sum (5) — a value that did not exist
     E            when the plan was written — into B, whose result is 15
```

The stored node inputs keep the **binding**, not the value: the runtime resolves it
at execution and never rewrites the immutable plan contract. And it
**re-checks the dependency edge itself** before honouring a binding
(`"A runtime data binding must reference a declared DAG dependency."`) — the
semantic layer refuses a binding without a dependency, and so does the durable
layer. Neither relies on the other having been careful.

---

## 7. Provider independence

A plan validates with **no provider configured anywhere**. Capability existence is
checked because the capability set is closed; provider resolution is not performed
at all, and the schema has no field for one.

```text
Goal understood → PlanGraph valid → capability known → no provider configured
                                  → execution BLOCKED_BY_PROVIDER
```

Proven end to end: a plan containing `notify` (external side effects, no adapter
configured here) materialises, runs, and the node reaches `WAITING` on owner
approval rather than completing. **A plan existing is not a run succeeding**, and a
`notify` node never reached `VERIFIED`.

---

## 8. Generality

Nine unrelated goals, planned with the same schema and the same seven generic
capabilities. Seven of the domains appear nowhere else in this codebase:

| | Goal | Kind | Domain seen before? |
|---|---|---|---|
| A | sell an idle **industrial lathe** above a floor price within 30 days | DAG | no |
| B | find a **sign-language court interpreter** under a fee ceiling | DAG | no |
| C | find seasonal **apiary pollination** contracts | DAG | no |
| D | organise a **falconry competition** needing several independent resources | DAG | no |
| E | watch a **desalination plant's** chlorine level, act only if it crosses | MONITORING | no |
| F | earn from idle **cold-storage** capacity | DAG | no |
| G | run a **mosque lending library** as a standing system | PERSISTENT_WORLD | no |
| H | stop notifications at night | SETTING_MUTATION | — |
| I | sign me in | IDENTITY_CHANGE | — |

`DOMAIN_PLAN_NODE_TYPES = 0`, enforced: the plan module's code (comments and string
literals stripped) contains none of *car, vehicle, driver, travel, flight, hotel,
restaurant, job, resume, commerce, purchase, booking, delivery, shop, conference,
lathe, falcon, bee*. `PlanNodeSchema.shape` is asserted to be exactly its seven
fields.

Case D is the one that shows why a graph beats a list: ground, judges and vets are
three **independent** resources that all depend on the brief and all feed the
schedule. A planner that serialised them would be inventing an order the goal never
asked for.

Case E is the one that shows honesty: with no measurement source connected, the plan
carries a blocker and reports `BLOCKED` instead of pretending to monitor.

---

## 9. The commerce ratchet

The transitional branch is **not expanded**. A ratchet test now pins it
(`tests/evals/plan-graph-evals.test.ts`), which did not exist before this phase:

```
branch count ≤ 7   (isPay, isApprove, isSelect, isPublish, isWorldCommerce, isCompare, isDiscovery)
label count  ≤ 6   (discovery-search, commerce-publish, commerce-select,
                    commerce-approve, commerce-pay, world-commerce)
```

Both may go **down** — that is the generic path absorbing them. Neither may go up: a
new `const isSomething =` in the commerce orchestrator fails the build, and so does
a new domain family in the core turn prompt. PlanGraph itself names none of the six
labels.

**No branch was deleted.** Equivalent generic behaviour has not yet been proven for
the existing commerce cases, and the rule is that deletion follows proof.

---

## 10. What is not yet true

- **No model has proposed a plan here.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.
  Every plan in every test is hand-written the way a model would propose one, which
  proves the contract and the validation but not that a model produces a *useful*
  plan from Arabic. That is the first thing to verify when a provider exists.
- **The turn path still uses the flat proposal materialization.** PlanGraph is not
  yet wired into `createRuntimeConversationTurn`. Wiring it means replacing the flat
  path, which changes what every existing conversational turn does — that deserves
  its own phase, with the commerce equivalence proof §19 requires before any branch
  is removed.
- **`composeRequirementGraph` is still uncalled.** PlanGraph resolves capability
  **ids** against a closed registry; that composer matches semantic **purposes**.
  They are complementary, not duplicates, and folding purpose-matching in is a later
  step.
