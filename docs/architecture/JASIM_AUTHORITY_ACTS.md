# JASIM — THE AUTHORITY ADMINISTRATION PATH

```
APPROVAL != CLICK
MODEL PROPOSES != RUNTIME PERFORMS
STATEMENT != SUMMARY
```

Creating an organization, granting a verb, setting a policy, binding a provider,
delegating a negotiating limit and agreeing are **one shape**: an authority act.
A person must be able to do each by speaking, and a plan may never do any of
them on their behalf.

---

## 1. Why this was the hardest gap

Not because the mechanism is difficult. Because the obvious implementation is
worse than not building it.

A capability called `set-negotiation-envelope`, plus a run summary the person
clicks «موافق» on, would have closed twenty-two scenarios and made every
guarantee in this repository decorative. A plan could propose
`{ reserve: 9999 }`, the summary would say "delegate negotiating authority", and
the person would have approved a number they never saw.

Two phases arrived at this gap from opposite directions — a business scope
nobody could administer by talking, and a negotiating limit nobody could
delegate by talking — which is what made it one gap rather than two missing
features.

## 2. The four steps

**1 · A model requests.** It names a registered act type and typed parameters.
It performs nothing, and `AUTHORITY_ACT_KEYS` refuses `approved`, `statement`,
`statementDigest`, `performed`, `principalId` and `scopeId` before the schema is
reached. An undeclared parameter is **refused, not dropped**: a parameter
silently discarded is one the person was never shown and the runtime never
used.

**2 · The runtime writes the statement.** From the act's **declared parameter
schema**, in declared order, so an act cannot choose what to leave out. From
**canonical state** for the scope's name, so a caller cannot rename a company
for the length of one sentence.

**3 · Every scalar appears.** The renderer *flattens* rather than summarising,
because a summary is where a number goes to hide:

```
bounds.price.direction   LOWER_IS_BETTER
bounds.price.target      200
bounds.price.reserve     250
bounds.price.concessionStep  25
mayConcede               true
```

Nested keys are **sorted**, so the digest depends on what the statement says and
not on how Postgres happened to store the `jsonb`.

An act that names a row must also say what that row says. «وافق على العرض
p_8f3a» is not something anyone can consent to, so `agreement.commit` expands
the proposal into every term, its unit and who owes it. A ratchet enforces this:
any act with an `Id`-suffixed parameter must declare an expansion.

**4 · The person cites the digest.** `statementDigest` is required by the API,
not optional — an approval that did not have to name what it approved would be a
click. Before performing, the runtime **re-renders from current canonical
state**: if the statement would read differently now, the approval is `VOID`
with `STATEMENT_CHANGED`. The permission is re-checked too, because a membership
can end between reading and deciding.

Then a CAS moves the row out of `PENDING`, and only then does the act perform.
One decision, one act.

## 3. What the statement holds

| | |
|---|---|
| `headline` | fixed in trusted code, one per act |
| `onBehalfOf` | the scope id, its kind, and its display name **from the database** |
| `lines` | every scalar of every declared parameter, plus the expansions |
| `reversibility` | and a residual note, required whenever it is not `REVERSIBLE` |

Saying IRREVERSIBLE without saying what survives is a warning label with nothing
on it.

## 4. What is refused

- **No blanket approval.** No "approve all pending", no "always approve this act
  type", no standing authorization. Each is an approval of something nobody
  read.
- **No capability performs an act.** `capability-registry.ts` does not import
  this module, and a test holds that.
- **No act may be someone else's decision.** The row names a *person*; a scope
  cannot read.
- **A person's own act cannot be done in an organization's name** —
  `organization.create` is `personalOnly`.
- **A permission is a verb from the closed set.** A role name reaching a
  membership row is how a `FactoryManager` gets born, so it is refused in
  trusted code even after the person approved it.

## 5. Read back, not reported

```
RECEIPT != VERIFICATION
```

`perform` returning an id is the act's own word about itself, and an act's own
word is worth nothing about an act. Every act declares a `readback` — required,
not optional — and the request records `VERIFIED` or `NOT_OCCURRED` from
JASIM's own reading:

| act | what is read back |
|---|---|
| `organization.create` | the row exists **and** its creator holds an active grant in it |
| `membership.grant` | an active grant holding every permission that was asked for |
| `membership.revoke` | the grant is `revoked` |
| `policy.set` | that policy id belongs to this scope, at that version |
| `provider.bind` | an active binding, reading the credential **name** |
| `negotiation.envelope.set` | the current envelope is this one, and its two flags |
| `agreement.commit` | the agreement exists and lists this party |

An organization nobody is a member of is a row, not a scope — which is why the
first readback checks two things.

### A readback can only find what the write actually named

```
RETURNED_REFERENCE MUST NAME DURABLE_STATE
UPSERT_RESULT != PREGENERATED_INPUT_ID
CONFLICT_UPDATE != NEW_BINDING_IDENTITY
A REFERENCE TO NOTHING != SUCCESS
WRITE_SUCCEEDED != READBACK_SUCCEEDED
```

`provider.bind` reads its effect back **by the id its `perform` returned**, which
is the right shape — an act's readback should not take the act's own word for
anything. But `bindScopeProvider` generated `bind_<uuid>` *before* an
`INSERT … ON CONFLICT DO UPDATE` and returned that candidate regardless of which
branch ran. On a rebind of a tuple that already had a live row, Postgres updated
**that** row, and the caller was handed an id no row carries. The readback then
looked it up, found nothing, and reported:

```
occurred: false — "No active binding of this scope has that id."
```

for a write that had just succeeded. A correct readback reporting a false
negative, because the reference it was given pointed at nothing.

The fix is to ask the write which row it wrote. `RETURNING` on `DO UPDATE` yields
the row as written, whichever branch ran, so the canonical id comes from the
statement itself — not from a second lookup, a «latest» heuristic or an
approximate search:

```ts
const [persisted] = await db.insert(scopeProviderBindings)
  .values({ id: candidateId, … })
  .onConflictDoUpdate({ target: […], targetWhere: sql`… IS DISTINCT FROM 'REVOKED'`, set: {…} })
  .returning({ id: scopeProviderBindings.id });
return { id: persisted.id };
```

No table, no column and no migration: one statement now reports what it did.

One thing was fixed in the same breath rather than left as a quieter version of
the same untruth. The conflict branch's `set` did not write `credentialEnvName`,
so re-binding with a new variable kept the old one — and this act's readback says
«reading \<name\>». While the readback could not find the row at all, that was
invisible; fixing the id is exactly what makes it observable. Both branches now
store what the call stated, «none» included, which is what the insert branch
always did.

The identity rule the reconnect phase established is untouched: the arbiter
predicate stays `lifecycle IS DISTINCT FROM 'REVOKED'`, so a revoked row is
history rather than a slot — with only revoked history, a legacy bind inserts a
new live row and mutates none of it.

## 6. The seven acts

```
organization.create   membership.grant   membership.revoke
policy.set            provider.bind      negotiation.envelope.set
agreement.commit
```

All general verbs over general primitives.

```
DOMAIN_AUTHORITY_ACTS_ADDED = 0
```

There is no `RestaurantOnboarding`. A new act is a row in one registry and
inherits the statement, the digest, the expiry and the re-render — an act that
wanted its own approval flow would be an act that wanted its own rules.

## 7. One defect the proof found

Envelopes were arriving `VOID` for having changed when nothing had. Parameters
are stored as `jsonb`, and Postgres does **not** preserve an object's key order,
so re-rendering produced the same lines in a different sequence and a different
digest. The renderer now sorts nested keys: a digest must depend on what the
statement says, not on how a database stored it.

It is worth naming what that bug was. The mechanism was refusing to act — which
is the safe direction — and would have been easy to "fix" by comparing something
looser. Comparing something looser is how the digest stops meaning anything.

## 8. What is not built

- **No enforcement of a policy.** A policy can now be set by talking and nothing
  in the runtime reads one. `POLICY_ENFORCEMENT` is what that gap is called.
- **No surface.** The statement travels in the turn's output and through
  `runtime.authorityRequestsList`, structured and ready to render. Nothing
  renders it yet, and a client that decided anything about it would be the UI
  becoming authority.
- **No delegation of delegation.** There is no act that grants someone the
  ability to approve on your behalf, and adding one would need its own evidence.
- **No re-approval flow.** A `VOID` request is not revived; the person asks
  again and reads the current version. Reviving one would be reviving words.

## Proofs — the returned reference

| where | what |
| --- | --- |
| `tests/block31/legacy-binding-return-identity.test.ts` | a fresh bind returns the id of the row it inserted; binding the same tuple again returns the row that already existed, leaves one live row, and stores the name the second call stated; four rebinds hand back one durable id and no candidate survives without a row; the act reports `occurred: true` on a fresh bind **and** on a rebind, naming the row that carries the binding and the name really on it; a bind with no credential name says «no credential» rather than keeping the old one; with only revoked history a legacy bind creates a new live row and leaves the revoked one byte-for-byte; with a revoked row beside a live one the live one is updated; four concurrent binds agree on one durable id with no driver error reaching a caller; a `NULL`-lifecycle row is what a rebind conflicts with and is still not an account for the connector runtime; resolution still finds the live binding and never the history; the modern reconnect ceremony still produces a new identity and the legacy upsert cannot reach either of its rows; the canonical id comes from the write, with no second lookup, no ordering and no limit |
