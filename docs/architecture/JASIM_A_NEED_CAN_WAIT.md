# JASIM — A NEED CAN WAIT

> «أخبرني عندما تظهر واحدة تحت ١٦ ألفاً» · «راقب السعر وإذا نزل أخبرني»

## THE GAP

`matchNeed` scans every public offering against a need. It had exactly **two
callers** — a router procedure and a capability — and both run because somebody
asked *at that moment*. **Nothing re-ran it**: not the duty cycle, not a
publication, not a trigger.

So JASIM could answer *"what exists now"* and never *"tell me when it exists"*.
A request whose answer had not been published yet came back empty and was
forgotten. That is the entire long-running half of the vision (§19) missing.

> **A NEED CAN WAIT · ANSWERING_ONLY_WHAT_EXISTS_NOW = 0**

---

## WHY THIS IS NOT A MONITOR

Every monitor source watches a **subject** — an observation about it, an
authorized read of it, an event from it, or its expected observation failing to
arrive. A need waiting for an offering that **does not exist yet** has no
subject to watch: the thing it waits for has no id, no row and no owner.
Threading that through an evaluator built around observation payloads would
have bent a careful module out of shape to hold something it was not about.

It runs in the **same duty cycle**, beside the monitors.

> **SECOND_SCHEDULERS_ADDED = 0**

---

## WHAT WAITING IS NOT

| Law | Behaviour |
|---|---|
| `NEW_MATCH != EVERY_SWEEP` | notifies on the **edge**, never on the level |
| `WAITING != PUBLISHING` | nobody is shown what this person wants |
| `MATCH != OFFER` | nothing reserved, nobody contacted — `TARGET / CONDITION != EXECUTION AUTHORITY` |
| `WAITING_FOREVER = 0` | every wait carries an end, and the ceiling is enforced here rather than trusted from a caller |
| `WAITING_IS_THE_OWNERS_CHOICE` | started, read and stopped only by them; never begun because a search came back empty |

The notice says **that** something changed, never **what it now says** — ids and
counts only. Reading the thing is a separate authorized act. Proven: the notice
contains no seller, no field name and no value.

---

## WHAT "NEW" MEANS, AND A DEFECT FOUND WHILE PROVING IT

The first implementation counted match rows before and after a sweep. It
reported the same candidate as news on **every cycle**, because — traced —
`matchNeed` **appends** a match row on each call rather than upserting. A row
count therefore grows whether or not the world changed.

The edge is now the set of **which offerings** are viable, not how many rows
exist. The failure mode the law names is precisely the one the naive
implementation had.

**A residual cost, recorded rather than hidden:** a standing scan calls
`matchNeed` repeatedly, and each call appends rows to `economic_matches`. The
ledger therefore grows with sweeps, not only with real change. The edge
detection is immune to it; the storage is not. Bounding it belongs to
`matchNeed` — either an upsert per `(need, offering)` or a skip when nothing has
been published since the last sweep — and is deliberately **not** done here,
because changing how every match in the runtime is written is its own phase with
its own blast radius.

---

## FROM A SENTENCE

«أخبرني عندما تظهر» starts it; «كفى» ends it. Dispatched **before** discovery,
deliberately: reading *"tell me when it exists"* as *"search now"* would answer
*"nothing found"* to somebody who just asked to be told later. A ratchet test
asserts that ordering directly against the dispatch source.

The answer names the three things a standing scan invites confusion about:
`reservesNothing`, `contactsNobody`, `published: false`.

---

## GENERALITY

A wait is a need plus an end date. What the need is about is the need's
business — the module's body names no field, no price, no stock and no alert.

> **DOMAIN_WATCHERS_ADDED = 0**

`tests/block31/a-need-can-wait.test.ts` — 15 tests.
