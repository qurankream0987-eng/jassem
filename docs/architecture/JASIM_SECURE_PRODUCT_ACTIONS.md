# JASIM — A SECURE PRODUCT ACTION

```
CONVERSATION INITIATES
  -> TRUSTED PRODUCT RUNTIME DEFINES
    -> TRUSTED SURFACE COLLECTS
      -> SERVER VALIDATES
        -> POLICY AUTHORIZES
          -> RUNTIME MUTATES
            -> AUDIT RECORDS
```

```
AUTHENTICATE != DAG NODE
MODEL RECOGNISES != MODEL DEFINES
SURFACE COLLECTS != SURFACE DECIDES
CLIENT STATE CLEARED != SESSION REVOKED
ACCOUNT CLOSED   != ACCOUNT DELETED
PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
```

---

## 1. What was actually there

Traced before anything was written, because the brief's first constraint was
*do not duplicate the authentication that exists*.

| | where | what it did |
|---|---|---|
| `users` | `db/schema.ts` | `unionId`, `name`, `status`, `preferences`. **No password column. No credential of any kind.** |
| `verifySessionToken` | `api/kimi/session.ts` | verifies a **stateless** `jose` JWT: `unionId` + `clientId`, one year, no jti, no server-side record |
| `requireAuth` | `api/kimi/auth.ts` | Bearer header, then cookie; the only door in |
| the exchange | `api/kimi/*` | an **external** identity is exchanged for that JWT. Nothing is configured to be exchanged. |
| `memberships` · `authorizeScopeAction` | `api/runtime/actor-scope.ts` | permission inside a scope |
| `membership.grant` · `membership.revoke` | `api/runtime/authority-acts.ts` | the conversational path to change a permission — a statement and a digest |
| `TRUSTED_PRODUCT_ACTION` | `api/runtime/semantic-router.ts` | a route the router already named, and honestly reported as unimplemented |

Two findings shaped everything that followed.

**There is no password in this repository.** Not hashed, not stored, not
verified. So "make password change work" was never available: what a secure
surface can do here is prove that a secret it collects reaches nothing, and say
truthfully that the thing which would consume it does not exist.

**A session token cannot be revoked by design.** It is stateless, has no id of
its own, and lives a year. The only revocation its shape permits is *everything
minted for this identity before now*. That is narrower than "log out this
device", and the runtime says so rather than rounding up.

## 2. What was built

### The registry — `api/runtime/product-actions.ts`

One module, 946 lines, and the **only** place a product action is defined:

```ts
type ProductAction = {
  id; version; title; consequence;
  authentication: "ANONYMOUS_ALLOWED" | "AUTHENTICATED";
  reauthentication: boolean;
  risk: "LOW" | "ELEVATED" | "HIGH" | "IRREVERSIBLE";
  fields: readonly { key; label; kind: "TEXT"|"EMAIL"|"CHOICE"|"BOOLEAN"|"SENSITIVE";
                     required; options? }[];
  confirmation: "NONE" | "EXPLICIT" | "EXPLICIT_PHRASE"; confirmationPhrase?;
  availability: "AVAILABLE" | "BLOCKED_BY_PROVIDER";
  ttlSeconds; idempotency; execute;
};
```

Six entries, each a general product verb and none a domain:

| id | auth | risk | confirmation | availability |
|---|---|---|---|---|
| `session.establish` | ANONYMOUS_ALLOWED | ELEVATED | NONE | BLOCKED_BY_PROVIDER |
| `account.create` | ANONYMOUS_ALLOWED | ELEVATED | NONE | BLOCKED_BY_PROVIDER |
| `session.revoke` | AUTHENTICATED | ELEVATED | NONE | **AVAILABLE** |
| `credential.rotate` | AUTHENTICATED | HIGH | EXPLICIT | BLOCKED_BY_PROVIDER |
| `settings.update` | AUTHENTICATED | LOW | NONE | **AVAILABLE** |
| `account.close` | AUTHENTICATED | IRREVERSIBLE | EXPLICIT_PHRASE | **AVAILABLE** |

`availability` is a **contract a surface renders**, so nobody types a password
into a door that does not open. It is not a short-circuit: the handler is asked
either way, and a blocked action states why it is blocked in its own words. A
generic short-circuit would have thrown those words away.

### Two tables — `db/migrations-pg/0018_product_actions.sql`

`product_action_sessions` holds one initiated action: an opaque
`pas_<43 base64url chars>` id, the action and **its version**, a nullable
`actorId` (null is how login is possible at all), an `anonymousRef` that binds a
pre-auth surface to one caller, the rendered presentation, a `record` holding
only the NON-sensitive part of what was submitted, an outcome and an expiry.

`identity_session_revocations` holds `unionId → revokedBefore`. `requireAuth`
consults it on **both** the Bearer and the cookie path, and a token that cannot
say when it was minted does not pass.

### Three functions, one boundary

```
initiateProductAction  — conversation opens a door
submitProductAction    — the ONE place a collected value is ever read
cancelProductAction    — «خلاص، لا» ends it, mutating nothing
```

Everything `submitProductAction` does happens in this order and no other:
the session is found for **this** caller, expiry is checked, the version is
checked, every submitted key is checked against the registry's declared fields,
a CHOICE value is checked against the registry's closed set, the confirmation
policy is satisfied by the person (not by the caller's say-so), and only then
does the handler run. A field the registry never declared is **refused**, not
dropped — silently dropping is how a caller learns which names are magic.

### The conversation's half

`jasim-runtime.ts` gained one optional envelope field:

```ts
productAction: z.object({ actionId: z.string().trim().min(1).max(80) }).strict()
```

That is the entire surface a model has. It may **name** a registered action. It
may not define a field, mark one sensitive, say a confirmation was given, or
claim somebody re-authenticated — `PRODUCT_ACTION_AUTHORITY_KEYS` mirrors
`AUTHORITY_KEYS` in `model-output-trust.ts` and is tested against it.

The branch returns `NEEDS_TRUSTED_SURFACE` and sits **before** the authority-act
branch. It creates no run, no DAG and no node: a trusted surface is not a step
in a plan, and a test asserts the block contains neither `createRuntimeRun(` nor
`createRuntimeDag(`.

### The surfaces

`TrustedProductActionSurface.tsx` (web, 308 lines) and its React Native twin
(329 lines) are **pure renderers of the server's contract**. SENSITIVE becomes
`type="password"` / `secureTextEntry`; CHOICE offers the registry's options and
nothing else; EXPLICIT_PHRASE shows the exact phrase; every exit from the form
calls `forget()` in a `finally`. Neither decides anything.

The transport lives in a separate `TrustedProductActionMount`, rendered only
when a product action exists — so a conversation without one touches no tRPC
hook at all.

## 3. The decisions that carry the phase

**A secret is read once and discarded.** The value never enters a conversation
message, an assistant reply, a Presentation IR payload kept for replay, an
event payload, or the model's prompt. This is proven, not asserted: a sentinel
string is driven through the whole live path and then hunted through
`messages`, `conversations`, `bubbles`, `events`, `product_action_sessions`,
`runs`, `dag_nodes`, `execution_attempts`, `observations` and `users`, plus
everything the model was asked and everything the turn returned. It is asserted
as an **absence**, and no test ever prints it.

**Logout is a server fact.** `revokeIdentitySessions` writes
`revokedBefore = now + 1s` and `requireAuth` enforces it. A token with no `iat`
is treated as revoked — fail closed, because "I cannot tell when this was
minted" is not a reason to accept it.

**Closing is not deleting.** `account.close` suspends the account and revokes
its sessions, and its consequence text says *«لا يحذف هذا بياناتك»* before the
person types the phrase. There is no erasure policy in this repository, and
inventing destructive deletion to make a scenario green would be the worst
false success this codebase could produce. The catalog records the gate as
unmet under a general gap named `DATA_ERASURE_POLICY` rather than calling the
closure a pass.

**Permission mutation was not duplicated.** No product action contains
"permission" or "membership" in its id. Granting and revoking a person's
authority stays an authority act with a statement and a digest, because a
second approval mechanism beside it is how two answers to "may they?" come to
exist.

**Idempotency is per action.** `settings.update` and `session.revoke` are
`SAFE_REPEAT` — replaying leaves the same final state. Replay of a completed
session is never a second act regardless.

**Provider-ready is not a fake integration.** Three of the six actions declare
`BLOCKED_BY_PROVIDER` and say why in their own words. Nothing simulates a login.

## 4. What is still not true

| | |
|---|---|
| password / credential rotation | there is no stored credential to rotate; an IDENTITY provider is unbound |
| sign in / sign up | the same — the exchange exists, nothing is configured to exchange with |
| per-device logout | the token has no id; revocation is per identity, before a timestamp |
| account deletion | no erasure policy, no retention rule, no tombstone — `DATA_ERASURE_POLICY` |
| an outside app's access | JASIM issues no delegated grant, so there is nothing to list or withdraw — `DELEGATED_ACCESS_RUNTIME` |
| an **anonymous** tRPC submission | the runtime supports it (`anonymousRef` binds a pre-auth surface to one caller, and a test proves login and signup need no identity). The transport does not: every ANONYMOUS_ALLOWED action is `BLOCKED_BY_PROVIDER`, so an unauthenticated mutation endpoint would be reachable attack surface serving no working flow. It arrives with the provider that makes those flows real. |
| stopping location sharing | JASIM shares no device location; the preference is recorded, and that is not the same thing |

```
GENERALITY FAILURE != PROVIDER NOT CONNECTED
FALSE_SUCCESS = 0
```
