# JASIM — ACTOR SCOPE

```
AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE
```

Authentication answers *who is using JASIM*. Acting scope answers *on whose
authority*. One person is one principal and may act as several scopes — their
own, and each organization they belong to.

A business is a **value the `ownerId` column can hold**. It is not a second
runtime, not a second intelligence, and not an app.

---

## 1. What an organization is

| | |
|---|---|
| `organizations` | id, display name, who created it, status, and `attributes` |
| `memberships` | the durable, revocable, audited grant — inherited, not invented here |
| `scope_policies` | versioned, append-only, private to the scope |
| `scope_provider_bindings` | which provider a scope uses, and the **name** of the credential |

`attributes` is where a business's *kind* lives. A restaurant, a factory and a
school differ in their attributes and in nothing else:

```
DOMAIN_BUSINESS_TYPES_ADDED = 0
DOMAIN_ROLES_ADDED          = 0
```

Eleven organization kinds — five familiar, six nobody designed for — go through
the same code in `tests/block31/actor-scope-runtime.test.ts`, and no production
line reads `attributes.kind`.

`memberships` already existed and already was durable, revocable and audited. No
new grant table was added, because adding one would have meant two answers to
"may they".

## 2. What a model may say

```
MODEL CANNOT SET:
  principalId · actingScopeId · organizationId · businessId · membershipId
  role · permissions · authority · provider binding ownership
```

A turn may carry an `actingScope` **request**:

```ts
{ intent: "PERSONAL" | "ORGANIZATION", organizationId?, organizationHint? }
```

and nothing else. `SCOPE_AUTHORITY_KEYS` **refuses** — never silently ignores —
any attempt to state membership or permission beside it. Ignoring an authority
claim is how a caller comes to believe it worked.

Resolution is never a guess:

| the person said | the answer |
|---|---|
| nothing | their own scope |
| «شخصياً» | their own scope |
| an organization they belong to | that scope |
| an organization they do not | `DENIED` |
| «باسم شركتي», one membership | that scope |
| «باسم شركتي», two plausible | `NEEDS_INPUT`, both named |
| «باسم شركتي», none | `DENIED` |

A name they gave that matches nothing is `DENIED` rather than "did you mean" —
listing organizations they are not in would leak who exists.

## 3. Membership is not permission

Resolving the scope answered *does this person belong here*. It did not answer
*may they do THIS here*.

Permissions are verbs and never roles:

```
view · publish · mutate · approve
manage_members · manage_policies · manage_providers · act_financially
```

Every capability declares the verb it needs **at registration**, in trusted code,
for the same reason it cannot declare what its own evidence is worth. Omitting
the declaration is safe and never permissive: the fallback is derived from the
effect kind, and a capability the registry cannot identify at all is charged
`mutate`.

The check runs at the **turn boundary**, which is the one place where both the
principal and the scope are known — not in the worker that later executes the
run, which knows only an owner id.

There is no `FactoryManager` and no `RestaurantOwner`.

## 4. Continuity

```
ESTABLISHED SCOPE != STANDING AUTHORITY
```

A conversation remembers **which scope it is being conducted for**. It never
remembers that the person may act there. What is carried forward is an ordinary
`ActingScopeRequest` — exactly the thing a model is allowed to produce — and it
goes through the same resolution on every turn.

So a membership revoked between two turns of one conversation is denied on the
second one, and «شخصياً» ends the organization scope rather than excusing one
turn from it.

Only an exact `organizationId` is carried, never a hint. Re-matching stale words
against a changed membership list is how a conversation silently moves to a
different organization.

A scope that stops resolving is **forgotten**, not retried: a memory that could
only ever be denied would lock a person out of their own work in that
conversation, and the denial itself is what tells them.

## 5. The data path

A read runs under the **acting** scope. «أرني عملياتي» said while acting for a
company is a question about the company, and cross-scope isolation is what makes
that safe rather than merely different.

One case needed naming. A resource whose owner column is numeric is keyed to a
**person**; an organization scope is not a number, so the owner predicate would
match nothing and the answer would be an empty table. That is a **false empty**:
it says the company has no conversations, when the truth is that a company
cannot hold one at all. Those are different answers and only one is honest, so
the read returns `UNAVAILABLE` and says so.

This is also the seam a business data source arrives at. An adapter an owner
connects registers its resource with its own owner column and reads through
`DataNeed → AuthorizedQuery → DataSource → CanonicalDataset` with **no new
branch**. No business row was fabricated to demonstrate that.

## 6. The market does not know

Person→Business, Business→Business and Business→Person go through the **same**
exchange and the **same** capabilities. A `BusinessMarketplace` beside a
`PersonalMarketplace` would be the failure.

A private constraint never crosses a scope boundary — not to another business,
and not from a person to their own employer.

## 7. What a binding stores

A provider binding records a provider id and the **name of an environment
variable**. No secret is stored, logged, projected or put in a model context.
Bindings do not inherit: a person's binding is not their employer's, and one
company's is not another's.

## 8. The UI is not authority

A client may let someone **choose** a scope. It may never decide that they hold
one. No file under `src/` imports the scope module, names a permission verb or
compares against one — an `if (permissions.includes("approve"))` in a browser is
an authorization a person can edit.

## 9. What is not built

- **No conversational administration.** Creating an organization, adding a
  member, granting a verb, setting a policy and binding a provider all exist as
  mechanisms and none is reachable by speaking. That is one gap —
  `SCOPE_ADMINISTRATION_PATH` — and it is deliberately one rather than a
  capability per administrative verb.
- **No business data source.** The seam is ready; nothing is plugged in.
- **No materialized business system.** Branding, a durable world and a dashboard
  are `PERSISTENT_WORLD_MATERIALIZATION`.
- **No negotiation, transaction, fulfillment, subscription or sponsored
  discovery.** Untouched, by instruction.
