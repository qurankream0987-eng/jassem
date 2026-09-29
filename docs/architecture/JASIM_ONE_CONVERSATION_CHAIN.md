# JASIM — ONE CONVERSATION DRIVES THE WHOLE CHAIN

## THE GAP: THREE RUNTIMES BEHIND A DOOR WITH NO HANDLE

| Runtime | Built and proven | Callers from a turn |
|---|---|---|
| `askCounterparty` | yes | **0** |
| `commitAgreement` | yes | **0** |
| `discloseToCounterparty` | yes | **0** |

And the reason was smaller and worse than any of them: **`proposeTurn` created
an engagement, a need and a proposal, bound none of them, and returned.** Every
later sentence — «اسأله إن كانت ما زالت موجودة», «أرسل له موقعي» — had nothing
to refer to. The conversation ended at *"proposal sent"* and the rest of JASIM
sat behind a door with no handle.

> **WHAT_A_TURN_CREATES_IS_NAMEABLE**

Four generic keys now carry it forward: `current:engagement`,
`current:counterparty_offering`, `current:need`, `current:proposal`. There is no
`current:mechanic` — a test asserts the keys name no domain.

---

## THE FOUR VERBS THAT WERE MISSING

| Sentence | Turn | What it will not do |
|---|---|---|
| «اسأله عن الحالة» | `askCounterpartyTurn` | the model does not write the question text — a **named property**, never free text |
| «ماذا رد؟» | `counterpartyAnswersTurn` | an answer given about an older revision reports `stale`, not silence |
| «أقبل» | `acceptProposalTurn` | with two open proposals it asks which; `AMBIGUOUS_ACCEPTANCE_GUESS = 0`. And it carries **no owner-direct authority** — see below |
| «أرسل له موقعي» | `discloseTurn` → confirm | releases nothing on the first turn |

---

## THE DISTINCTIONS THAT MUST NOT COLLAPSE

**`OWN_CONFIRMATION != COUNTERPARTY_ACCEPTANCE`**
«أوافق» pins one's *own* draft. «أقبل» is the other party saying yes to what
was sent. Reading one as the other would let a buyer's confirmation of their own
words look like a seller's acceptance.

**`MODEL_EXTRACTION != OWNER_DECLARATION`**
The model decided which field «أرسل له موقعي» meant. A released address cannot
be un-released, so the release is **shown** first — the exact field, its value,
and the recipient — and **performed** second. The pending release is pinned in
the binding itself (`agreement|subject|field|recipient`), so a confirmation
cannot release a different field to a different person than the one shown.

**`MODEL != AUTHORITY` · `CLASSIFICATION != ACCEPTANCE`**
`acceptProposalTurn` first passed the direct-acceptance flag, and an inherited
ratchet on who may set it caught that — correctly. That flag means *the owner
themselves is accepting, now*, and it is reserved for the two places a person is
provably present: the API surface they clicked, and the authority act whose
statement they read term by term before citing its digest. **A classified
sentence is neither** — the model decided that «أقبل» meant accept, and a model
that could raise that flag would bind somebody to a term sheet by classifying a
sentence.

So conversational acceptance goes through the **envelope** basis: bounds the
party set in advance, evaluated against the incoming terms, refusing anything
past the reserve. JASIM says yes for you only inside limits you set yourself —
and when you set none it says so plainly, rather than guessing. The two trusted
direct-acceptance paths are untouched; the ratchet passes unmodified.

**`AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY`**
Before an agreement exists, «أرسل له موقعي» releases nothing, whatever is said.

**An agreement is held by every party to it.**
Bound for each participant, not only for whoever said yes — otherwise the
buyer's very next turn cannot find the agreement the seller just accepted. The
participants are read from the agreement itself, so each party learns only that
the agreement they are *already* party to exists.

---

## ORDER OF DISPATCH, AND WHY

A pending **release** is confirmed before a pending statement: nothing else is
waiting on a yes that cannot be taken back. Releasing and asking are checked
before approval and selection, because both name a counterparty rather than a
result — «أرسل له موقعي» must never be read as picking something.

---

## GENERALITY

The identical sentence sequence — search, take the first, request it, accept,
release — runs for `mobile.repair`, `seabed.survey`, `artifact.conservation`,
`machine.hire` and `interpreting.onsite`, releasing a meeting point, a site
access note, a humidity window, a yard code and a building entrance. Not one
line of dispatch branches on what is being bought.

> **NEW DOMAIN != NEW AGENT · NEW EXAMPLE != NEW FEATURE FAMILY**

`tests/block31/one-conversation-chain.test.ts` — 13 tests.
