# JASIM — SECURE PRODUCT ACTION RUNTIME · phase report

```
CONVERSATION INITIATES · TRUSTED RUNTIME DEFINES · TRUSTED SURFACE COLLECTS
SERVER VALIDATES · POLICY AUTHORIZES · RUNTIME MUTATES · AUDIT RECORDS

PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
```

---

## 1. §0 · The trace, and the two findings that changed the plan

The brief's first instruction was *trace the authentication that exists and do
not duplicate it*. What exists:

- `users` with `unionId`, `name`, `status`, `preferences` — **no password
  column and no credential of any kind**;
- a **stateless** one-year `jose` JWT carrying `unionId` + `clientId`, with no
  `jti` and no server-side record;
- `requireAuth`, Bearer then cookie, the only door in;
- `memberships` + `authorizeScopeAction` for permission, and
  `membership.grant` / `membership.revoke` as authority acts for changing it;
- `TRUSTED_PRODUCT_ACTION`, a route the semantic router already named and
  honestly reported as unimplemented.

**Finding one: there is no password here to change.** So "make password change
work" was never on the table. What a secure surface can do is prove that a
secret it collects reaches nothing at all, and say truthfully that the thing
which would consume it is not connected.

**Finding two: the session token cannot be revoked by design.** No id, no
record, one year. The only revocation its shape permits is *everything minted
for this identity before now*. That is narrower than per-device logout, and the
runtime records the narrower fact rather than rounding up.

Nothing was duplicated. No `users_v2`, no `sessions_v2`, no `auth_v2`, no
second password system and no second permission system.

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/product-actions.ts` | 946 | the registry, the three boundary functions, six actions |
| `db/migrations-pg/0018_product_actions.sql` | 73 | `product_action_sessions`, `identity_session_revocations` |
| `src/components/jasim-core/TrustedProductActionSurface.tsx` | 308 | web surface — a pure renderer of the server contract |
| `src/components/jasim-core/TrustedProductActionMount.tsx` | 39 | the transport half, mounted only when an action exists |
| `artifacts/jasim-mobile/components/TrustedProductActionSurface.tsx` | 329 | the same contract in React Native |

Touched: `api/kimi/{types,session,auth}.ts` (the token learns its own `iat`,
and `requireAuth` consults revocation on both paths), `api/runtime/
jasim-runtime.ts` (one optional envelope field and one branch),
`api/routers/runtime.ts` (`productActionSubmit`, `productActionCancel`),
`api/runtime/model-output-trust.ts` (the product-action authority keys),
`db/schema-block2.ts`, `src/components/chat/ChatMessage.tsx`.

## 3. The decisions that carry the phase

**The model's entire surface is one field.** `productAction: { actionId }`,
`.strict()`. It may **name** a registered action. It may not define the input
schema, mark a field sensitive, say a confirmation was given, claim
re-authentication, or say who the actor is. `PRODUCT_ACTION_AUTHORITY_KEYS`
mirrors `AUTHORITY_KEYS` and is tested against it.

**A trusted surface is not a plan step.** The branch returns
`NEEDS_TRUSTED_SURFACE`, sits before the authority-act branch, and creates no
run, no DAG, no node — asserted by grep on the branch's own body.

**An undeclared field is refused, not dropped.** Silently dropping is how a
caller learns which names are magic.

**`availability` is a contract, not a short-circuit.** A first draft
short-circuited on `BLOCKED_BY_PROVIDER` and swallowed each action's own reason
for being blocked. The short-circuit was removed: the handler is always asked,
and a blocked action says why in its own words.

**Closing is not deleting.** `account.close` suspends and revokes, and says
*«لا يحذف هذا بياناتك»* before the person types the phrase. No erasure policy
exists, and inventing one would be the worst false success this codebase could
produce.

**Permission mutation was not duplicated.** No product action id contains
"permission" or "membership". That door stays an authority act.

**The tRPC transport is authenticated-only, deliberately.** The runtime
supports an anonymous caller — `anonymousRef` binds a pre-auth surface to one
caller, and a test proves `session.establish` and `account.create` need no
existing identity. The transport does not, because every ANONYMOUS_ALLOWED
action registered today is `BLOCKED_BY_PROVIDER`: an unauthenticated mutation
endpoint would be reachable attack surface serving no working flow. It arrives
with the provider that makes those flows real, and both the router and the
architecture note say so rather than leaving it to be discovered.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/secure-product-action.test.ts` | 35 |
| `tests/unit/product-action-contract.test.ts` | 32 |
| `tests/unit/trusted-action-surface.test.tsx` | 11 |
| `tests/unit/generality-catalog.test.ts` (new assertions) | 6 |

**The sentinel hunt.** A sentinel is driven through the live path — a
conversation names `credential.rotate`, the trusted surface collects three
SENSITIVE fields, the runtime validates and the handler receives them — and is
then hunted through `messages`, `conversations`, `bubbles`, `events`,
`product_action_sessions`, `runs`, `dag_nodes`, `execution_attempts`,
`observations` and `users`, plus everything the model was asked and everything
the turn returned. Asserted as an absence; never printed.

**The six live proofs.**

| | |
|---|---|
| A | «سجلني دخول» opens a trusted surface and no DAG |
| B | «سجلني خروج» revokes the actual session — every token minted before now stops being accepted, on both the Bearer and the cookie path, and another identity is untouched |
| C | a secret typed into the surface appears nowhere (the hunt above) |
| D | a safe setting mutation runs, is visible, and repeats to the same final state |
| E | a destructive action needs its exact phrase before anything happens; a question does not become a deletion |
| F | a tampered action id and a forged session both fail closed; another person's action session is simply not found |

**Reference continuity.** A trusted surface is a detour, not an exit. The
conversation that opened the door is still the conversation afterwards:
«غيّره مرة ثانية» in the same conversation opens a **new** door rather than
replaying the closed one, the completed session refuses a second submission,
the new one carries the change forward, and both rows name the conversation
that started them.

**§26 · the multi-party ratchet.** `beneficiaryOf` no longer guesses. A term
with no `owedTo` among three parties has no "other party" to infer, so
`materializeTransaction` **rejects** it with `INVALID` instead of picking one.

## 5. Catalog effect

`SECURE_PRODUCT_ACTION_RUNTIME` is **closed** — the sixth gap in six phases.

| gate | before | after |
|---|---:|---:|
| PLANNABLE | 138 | **147** |
| EXECUTABLE | 89 | **92** |
| OBSERVABLE | 76 | **80** |
| VERIFIABLE | 71 | **74** |
| PERSISTENT | 128 | **137** |
| blocked by a **provider** | 35 | **39** |
| waiting on a general capability | 40 | **33** |
| distinct general gaps | 10 | **11** |

**Nine scenarios moved, and only three of them to a full PASS.** The eight
`SECURE_PRODUCT_ACTIONS` entries had shared one verdict while the mechanism did
not exist; they stop being one block and are graded one at a time:

| scenario | EXECUTABLE | why |
|---|---|---|
| `route.product_action` · `product.logout` · `product.settings` | **PASS** | they run today, end to end, and are read back |
| `product.login` · `product.signup` · `product.password_change` | **BLOCKED_BY_PROVIDER** | JASIM stores no password and verifies none; the `IDENTITY` provider class is unbound |
| `product.privacy` | **BLOCKED_BY_PROVIDER** | the preference write is real, but JASIM shares no device location, so recording a preference is not withdrawing a live grant |
| `product.account_deletion` | **NOT_YET_IMPLEMENTED** | the closure runs and says it deleted nothing — the person asked for deletion, and `DATA_ERASURE_POLICY` does not exist |
| `product.permissions` | **NOT_YET_IMPLEMENTED** | a person's authority is revoked today via `membership.revoke`; an outside application's delegated access is a grant JASIM never issues — `DELEGATED_ACCESS_RUNTIME` |

Two new general gaps were named rather than hidden inside the closed one, and
one new provider **class** — `IDENTITY` — so that "no identity provider is
connected" can never be mistaken for "JASIM cannot sign anybody in".

**162 scenarios · 16 blind holdouts · 7 blind ideas · 11 general gaps.**

## 6. §27 · What `BUSINESS_SCOPE_READY = PASS` meant

Clarified in `JASIM_TRANSACTION_FULFILLMENT_REPORT.md` without weakening the
result. It is a statement about the transaction core: transactions behave
identically for a person and for an organization, and the core contains no
organization type, no business role and no branch that asks which it is. It is
**not** a claim of a full membership runtime, team management, RBAC
administration or business onboarding — none of which exists — and no later
phase may cite it as if it were.

## 7. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2167 passed, 27 skipped · 94 files | 2118, 27 · 92 | +49, +2 files |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 516 · 33 files | 481 · 32 | +35, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript (`tsc -b`) · Web build · Mobile typecheck · Expo export | all clean | | |

**No inherited test was weakened.** One test written *in this phase* was
corrected. The opaque-identifier check greped the session id for
`String(actor.id)` — and `users.id` is a serial, so when it came back as a
single digit the assertion was comparing one character against a 43-character
random blob. It proved nothing and failed at random: two of the first five
Block 3.1 runs went red on it, and the first of those was nearly written off as
noise. It now tests the property actually claimed — the id contains neither the
actor's `unionId` nor the action's name, **and** the same actor opening the
same action twice gets two different doors.

Block 3.1 has run clean four times since, in runs with nothing else against the
proof database. A fifth run went red with four failures while a second suite
was running against that same database concurrently; that is a collision, not a property
of any test, and the final verification run was made alone. The hazard is now
written down as a standing rule in `JASIM_TEST_SUITE_CONTINUITY.md`, together
with the reverse trap: a red run is dismissed only after a clean run alone,
never because it looked like noise.

## 8. The final report

```
PHASE = SECURE_PRODUCT_ACTION_RUNTIME

CURRENT_GAP_PROVEN              = PASS
EXISTING_AUTH_TRACED            = PASS
AUTH_DUPLICATED                 = NO
PRODUCT_ACTION_REGISTRY         = PASS
GENERAL_ACTION_VERBS            = 6
TRUSTED_ACTION_SESSION          = PASS
OPAQUE_SHORT_LIVED_SINGLE_USE   = PASS
PRE_AUTH_FLOW                   = PASS
AUTHENTICATED_FLOW              = PASS
SERVER_SIDE_VALIDATION          = PASS
POLICY_AUTHORIZATION            = PASS
CONFIRMATION_IS_NOT_A_CLICK     = PASS
PER_ACTION_IDEMPOTENCY          = PASS
CANCEL_AND_ABANDON              = PASS
REFERENCE_CONTINUITY            = PASS
AUDIT_WITHOUT_CREDENTIALS       = PASS
SESSION_REVOCATION_IS_SERVER_SIDE = PASS
PROVIDER_READY_WITHOUT_FAKES    = PASS

SECRET_IN_MODEL_CONTEXT         = 0
SECRET_IN_CONVERSATION_STORAGE  = 0
SECRET_IN_OBSERVABILITY         = 0
SECRET_IN_PRESENTATION_REPLAY   = 0
SENTINEL_PRINTED_TO_STDOUT      = 0

USERS_V2_CREATED                = 0
SESSIONS_V2_CREATED             = 0
AUTH_V2_CREATED                 = 0
PARALLEL_PASSWORD_SYSTEMS       = 0
PARALLEL_PERMISSION_SYSTEMS     = 0
DOMAIN_PRODUCT_ACTIONS_ADDED    = 0
NEW_DOMAIN_BRANCHES             = 0

MODEL_DEFINES_SCHEMA            = NO
MODEL_MARKS_SENSITIVE           = NO
MODEL_ASSERTS_CONFIRMATION      = NO
MODEL_ASSERTS_REAUTHENTICATION  = NO
MODEL_NAMES_ACTOR               = NO
MODEL_PERFORMS_MUTATION         = NO

AMBIGUOUS_MULTI_PARTY_BENEFICIARY = REJECTED
BUSINESS_SCOPE_READY_CLARIFIED    = PASS

DESTRUCTIVE_DELETION_INVENTED   = NO
FALSE_LOGOUT_SUCCESS            = 0
FALSE_SUCCESS                   = 0

CATALOG_SCENARIOS_MOVED = 9
  CONVERSATION_ROUTING   · route.product_action                  -> PASS
  SECURE_PRODUCT_ACTIONS · product.logout, product.settings      -> PASS
  SECURE_PRODUCT_ACTIONS · product.login, signup, password_change,
                           product.privacy                       -> BLOCKED_BY_PROVIDER
  SECURE_PRODUCT_ACTIONS · product.account_deletion              -> DATA_ERASURE_POLICY
  SECURE_PRODUCT_ACTIONS · product.permissions                   -> DELEGATED_ACCESS_RUNTIME

GAPS_CLOSED = SECURE_PRODUCT_ACTION_RUNTIME
GAPS_NAMED  = DATA_ERASURE_POLICY, DELEGATED_ACCESS_RUNTIME
PROVIDER_CLASS_NAMED = IDENTITY

MAIN              = 2167/27 · 94 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 516 · 33 files
FROZEN_EVALUATION = 90 · 5 files

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS

INHERITED_TESTS_WEAKENED = 0
TESTS_CORRECTED          = 1  (this phase's own flaky opaque-id assertion)

NEXT_GENERIC_GAP = PERSISTENT_WORLD_MATERIALIZATION
```

Eleven gaps, and what is left of the routing table is where the weight sits:
`PERSISTENT_WORLD_MATERIALIZATION` holds 9 scenarios, `MONITORING_ENGINE` 7 and
`REALTIME_RUNTIME` 5. The world gap is the one to take next — it is the last
route the semantic router names and honestly reports as unimplemented, and
unlike `MONITORING_ENGINE` it needs no scheduler to be true.

`DATA_ERASURE_POLICY` and `DELEGATED_ACCESS_RUNTIME` carry one scenario each.
They are small, they are real, and neither may be quietly folded into another
phase's claim to make a number move.
