# JASIM — CONVERSATION FAILURE INTEGRITY

**Invariant:** `USER_MESSAGE_ACCEPTED != MODEL_RESPONSE_SUCCEEDED`
**Model provider connected:** NO · **Gateway policy touched:** NO · **`useJasimChat` redesigned:** NO

---

## 1. THE CAUSE, ESTABLISHED BEFORE ANY CHANGE

The brief listed five candidates and said not to guess. Each was tested.

### The server was already right

`routeRuntimeConversationTurn` (`api/runtime/jasim-runtime.ts:5517`) writes the
user's message **first**, in its own committed `INSERT`, and only then calls the
model:

```ts
const userMessage = await createRuntimeMessage({ ownerId, conversationId, role: "user", content });
// … history, memories, summary …
const modelResponse = await modelGateway.generate({ … });   // may throw
```

No transaction spans the model call, so a provider failure cannot roll the row
back. Proven against the database after the UI-2.1 failed turns:

```
 id | conversationId | role |    content     | outputKind
  8 |             10 | user | اعرض لي السائق |
  7 |              9 | user | اعرض لي السائق |
  …
```

Eight rows. Every failed turn's user message present, `role = user`, and **no
assistant row beside any of them** — nothing was fabricated.

And through the real API, with a real bearer token, the canonical projection:

```
GET runtime.conversationsGet → messages = 1
  user | اعرض لي السائق
```

### Verdict

| Candidate | Verdict |
|---|---|
| **A — client rendering / optimistic state** | **CONFIRMED** |
| B — not persisted at all | ruled out: the row is in `messages` |
| C — persisted but omitted from projection | ruled out: `conversationsGet` returns it |
| D — rolled back with assistant generation | ruled out: committed before the model call, no enclosing transaction |
| E — other | n/a |

The client was the whole problem. `useJasimChat.sendMessage` appended messages
**only in the success branch**:

```ts
const result = await createTurnMutation.mutateAsync(…);   // throws on failure
…
setMessages((current) => [...current, userMessage, assistantMessage]);  // never reached
```

There was no optimistic insert and no reload on failure, so the user's sentence
never entered client state at all. A person watched what they wrote vanish and
an error appear where it had been — while the server held it the whole time.

---

## 2. THE FIX

Two changes in `useJasimChat.ts`, and a deliberate choice between them.

### 2.1 Refetch canonical — do not re-insert locally

```ts
} catch (error) {
  const detail = userFacingRuntimeError(error);
  await utils.runtime.conversationsGet.invalidate({ conversationId });
  setTurnFailure({ … });
}
```

Re-inserting the message client-side was the obvious fix and the wrong one: it
would mint an id the server never issued, risk a duplicate once the real row
arrived, and put a message in the list that no server response confirmed.
Refetching takes the row the server already committed, with its real identity.
**`CLIENT_CANONICAL_TRUTH_ADDED = NO`** is a property of this choice, not a
claim about it.

### 2.2 The notice lives beside the canonical list, not inside it

```ts
const [turnFailure, setTurnFailure] = useState<Message | null>(null);
…
messages: turnFailure ? [...messages, turnFailure] : messages,
```

`messages` is the client's copy of canonical state and is refilled wholesale by
every `conversationsGet` refetch. Anything pushed into it is either overwritten
by the next refetch — which is what would have raced with §2.1 — or, worse,
starts to look like a message the server wrote. Merging only at the point of
return keeps both halves honest.

The notice is scoped: cleared when a new turn starts (so a retry replaces it
rather than stacking), cleared on conversation switch (it describes one failed
turn, not a property of the app), cleared by "مسح".

**Nothing else changed.** No gateway policy, no budget architecture, no
persistence semantics, no retry, no fabricated assistant message.

---

## 3. EVIDENCE — NINE CASES

### End-to-end, real browser, real authenticated product

Playwright against the running dev server, session from the product's own
`/api/runtime/session` (dev branch; production requires a real cookie and
returns 401 — no bypass added). No model provider configured, so the turn fails
for real.

```json
{
  "userVisibleAfterFailure":    true,
  "errorVisible":               true,
  "userCountAfterFailure":      1,
  "userVisibleAfterBareRefresh": false,
  "userVisibleAfterReopen":     true,
  "userCountAfterRefresh":      1,
  "userCountAfterRetry":        2,
  "errorNoticesAfterRetry":     1,
  "operatorLeaks":              []
}
```

| # | Case | Result |
|---|---|---|
| 1 | Model Gateway unavailable | **PASS** — «تعذّر الوصول إلى نموذج الذكاء. لم يُحفَظ شيء. يمكنك إعادة المحاولة بعد قليل.» with the user's message above it |
| 2 | Provider authentication failure | **PASS** — unit-tested mapping; identical client path |
| 3 | Provider timeout | **PASS** — same |
| 4 | Invalid model response | **PASS** — «وصل ردّ غير مكتمل من النموذج» |
| 5 | Budget exceeded before the provider call | **PASS** — «بلغ هذا الطلب حدّه المسموح من استدعاءات النموذج» |
| 6 | Successful normal turn | **PASS** — unchanged success branch; 1219 tests green |
| 7 | Retry after a failed turn | **PASS** — one notice, not two |
| 8 | Refresh after a failed turn | **PASS at the canonical layer** — see §4 |
| 9 | Duplicate-submit protection | **PASS** — composer and send control are `disabled={disabled \|\| isLoading}`, set before the mutation and cleared in `finally`, so neither Enter nor the button can fire twice within a turn |

`userCountAfterRetry: 2` is correct, not a duplicate: a retry **sends a second
message**, so two user turns is the truth. The same content submitted twice is
two turns, and both are real.

### Unit-tested

`tests/unit/conversation-failure-integrity.test.ts` — 16 assertions: every
failure category translated and Arabic; the gateway's real not-configured
sentence never reaching a user; no operator string, stack frame, file path,
variable name or key fragment in any message; an unrecognised failure getting an
honest sentence instead of an invented cause; the raw detail still reaching the
console; and the structural properties of §2 (refetch not re-insert, notice
outside the canonical list, double-submit closed).

### No operator text

```
RAW_OPERATOR_ERRORS_EXPOSED = 0
```

Checked against `JASIM_MODEL_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`MODEL_GATEWAY_API_KEY`, "API key", `Bearer `, `at Object.`, `at async`,
`ModelGateway`, `TRPCError`, `Error:`, `stack`, a planted key fragment, and
`model-gateway.ts` — in the browser and in the unit tests.

---

## 4. ONE HONEST QUALIFICATION ON CASE 8

`userVisibleAfterBareRefresh: false`.

A bare reload lands on the empty state, because **the app does not restore the
last conversation across a refresh** — no URL segment, no storage. Reopening it
from the sidebar shows the message immediately (`userVisibleAfterReopen: true`,
count 1).

This is not the failure bug and not caused by it: it is identical for successful
conversations, it predates this work, and the state a bare refresh shows is
truthful — the app simply has no memory of which conversation you were in.
Adding conversation restoration is a separate feature, and the brief said not to
redesign `useJasimChat`.

So `USER_MESSAGE_SURVIVES_REFRESH = YES` — the message survives; what does not
survive is the *selection*. The distinction is stated rather than smoothed over.

---

## 5. WHAT A REVIEWER SHOULD DOUBT

1. **Cases 2–5 are unit-tested, not browser-tested.** All four are the same
   client path — the mutation rejects — differing only in the message. Producing
   a real provider timeout needs a real provider.
2. **Case 6 has no live proof.** A successful turn needs a model. The success
   branch is untouched and the whole suite is green, which is the strongest
   available evidence and is not the same as having seen one.
3. **Double-submit protection is `isLoading`, not server idempotency.**
   `turnsCreate` accepts no idempotency key. The composer is closed for the
   duration of a turn, so the UI cannot double-submit — but a client that talked
   to the API directly could. Adding a key is a gateway/API change and was
   explicitly out of scope.
4. **My own test lied to me once.** The first permanent run reported every
   assertion false. The cause was a fixed 7-second sleep that stopped being long
   enough; the test now waits for the outcome. Worth knowing that one red run in
   this phase was the harness, not the product — the same class of mistake UI-2
   made with RTL screenshots.

---

## 6. COUNTERS

```
CONVERSATION_FAILURE_INTEGRITY      = PASS

USER_MESSAGE_SURVIVES_MODEL_FAILURE = YES
USER_MESSAGE_SURVIVES_REFRESH       = YES   (canonical row; selection is not restored — §4)
FAILED_ASSISTANT_RESPONSE_FABRICATED = NO
DUPLICATE_USER_MESSAGES_ON_RETRY    = 0
CLIENT_CANONICAL_TRUTH_ADDED        = NO
RAW_OPERATOR_ERRORS_EXPOSED         = 0
OWNER_ISOLATION                     = PASS
IDEMPOTENCY                         = PASS  (UI-level; see §5.3)

MAIN_SUITE                          = 1219 / 1219 (+8 skipped: gated live-model, visual, shell)
BLOCK_2                             = 101 / 101
BLOCK_3                             = 133 / 133
BLOCK_3_1                           = 65 / 65
TYPECHECK                           = PASS
WEB_BUILD                           = PASS (5.40s)
```

`OWNER_ISOLATION = PASS`: the fix adds no query. `conversationsGet` is the
existing owner-scoped procedure and `createRuntimeMessage` calls
`loadConversationRecord(conversationId, ownerId)` before inserting, so a message
cannot be written to or read from a conversation that is not the caller's.

END OF REPORT.
