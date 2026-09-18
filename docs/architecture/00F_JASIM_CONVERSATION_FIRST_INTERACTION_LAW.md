# 00F — JASIM CONVERSATION-FIRST INTERACTION LAW

**Status:** BINDING · **Recorded:** 2026-09-18 · **Source:** product owner, verbatim
**Scope:** JASIM App · JASIM OS · Generated World — the shared core, all three surfaces
**Implementation status:** NOT IMPLEMENTED. Recorded only. Architecture Freeze remains ACTIVE.

---

## 0. Why this is recorded, not built

The owner supplied this as a law, framed explicitly as a natural continuation of the
Master Product Vision (00D) rather than a new initiative. It is written down here in
full, in the terms it was given, so that it binds the next implementation wave.

Nothing in this document has been implemented. No authentication surface, no settings
mutation, no credential boundary, no navigation change has been written. The current
wave (Product Completion Wave 1) is a polish and correctness wave and deliberately
did not touch any of it.

---

## 1. THE LAW

```text
JASIM CONVERSATION-FIRST INTERACTION LAW

The main conversation is the primary product interface.

Traditional application screens should not be permanent merely because
traditional apps have them.

When the user expresses an intent, JASIM may generate the smallest secure
interaction surface required to complete it.

Examples:

"سجلني دخول"        → SECURE_LOGIN_SURFACE
"أنشئ لي حساب"       → SIGNUP_SURFACE
"سجلني خروج"        → LOGOUT_CONFIRMATION → trusted action → EXIT
"غير كلمة المرور"    → SECURE_PASSWORD_SURFACE
"احذف حسابي"        → IMPACT + REAUTH + CONFIRMATION
"غيّر هذا الإعداد"    → SETTINGS_MUTATION_SURFACE only if needed

CRITICAL SECURITY RULE:

Passwords, authentication secrets, payment credentials, tokens and biometric
secrets must NEVER be routed through the LLM context or persisted as normal
conversation messages.

Conversation may initiate the action.
Trusted UI/runtime collects and processes secrets.
LLM != credential processor.

Generated surfaces must follow:

ENTER → UPDATE → MORPH → EXIT

Once the purpose is complete, temporary authentication/settings surfaces must
disappear.

Do not create permanent traditional navigation merely to expose capabilities.

Conversation is the control plane.
Generated UI is the temporary interaction instrument.
Canonical runtime is the authority.
```

---

## 2. The interaction shape

```text
Conversation
  → Intent
  → Generated Surface
  → Trusted Action
  → State Change
  → Surface Exit
```

A login screen is not a place a person lives. It appears because an intent needed it,
it collects what only it may collect, and it leaves. Afterwards the person is back in
the conversation, which is where they were the whole time.

---

## 3. The credential boundary

This is the part of the law with the sharpest edge, and the owner stated it as a
correction to their own example — the literal reading, where a person types a password
into the chat box and the message is sent to a model, is **wrong**.

```text
User: «سجلني دخول»
        ↓
JASIM understands AUTH intent
        ↓
Secure Credential Surface appears
        ↓
email / password go DIRECTLY to the trusted auth boundary
        ↓
LLM never sees the password
        ↓
Auth succeeds
        ↓
surface disappears
```

The non-negotiable inequality:

```text
PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL   !=   LLM CONTEXT
```

The conversation may **initiate** an authentication. It may never **carry** the secret.

### 3.1 The accidental-credential case

The owner named this explicitly as a later concern, not a now concern:

> حتى لو كتب المستخدم كلمة مرور داخل الدردشة عرضًا، يجب أن نفكر لاحقًا في منعها
> من دخول model context أو على الأقل اكتشاف credential-like secrets وحمايتها قبل الإرسال.

So there are two distinct obligations, and only the first is absolute today:

| | Obligation | Status |
|---|---|---|
| **A** | A secure surface never routes its secret through the model | LAW — binding on any future implementation |
| **B** | A secret a person types into the chat box by accident is detected and withheld | ACKNOWLEDGED FUTURE WORK — the owner said «لاحقًا» |

**Obligation B has a live intersection that must be recorded now.** Wave 1 added
server-side conversation titles derived from the first user message
(`api/runtime/conversation-title.ts`). That derivation is a truncation of what the
person wrote, stored on the conversation row and shown in the sidebar. If a person
pastes a credential as their first message, it becomes a title. This is not a new
exposure — the message itself was already stored and already sent to the model — but
it is a second place the same text lands, and whatever satisfies obligation B must
cover the title derivation as well as the model call. Written down here so it is not
discovered later.

---

## 4. Where this touches what exists

The law is not a redesign of the runtime. It is consistent with the trust chain
already built, and it names which existing mechanism owns each step:

| Law step | Existing mechanism | State |
|---|---|---|
| Intent from conversation | output router / `resolveRuntimeReferences` | EXISTS |
| Generated surface | `decidePresentation` / `PresentationRenderer` | EXISTS |
| Surface may not be model-chosen | trusted presentation registry; the client may not select a privileged primitive | EXISTS, and this law does not relax it |
| Trusted action | `dispatchTrustedAction` / `TrustedActionEnvelope` | EXISTS |
| State change | canonical runtime | EXISTS |
| Verification | CompletionPolicy / effect assertions | EXISTS |
| Surface exit | `ENTER → UPDATE → MORPH → EXIT` transitions | PARTIAL — morphing exists, a purposeful EXIT does not |
| Secure credential surface | — | **DOES NOT EXIST** |
| Auth / settings / account intents | — | **DOES NOT EXIST** |

Two consequences follow immediately and are stated so the next wave does not have
to rediscover them:

1. **A credential surface is not a presentation primitive like the others.** Every
   other primitive renders data the runtime decided. This one collects data the
   runtime must never have seen in transit, and the model must not be able to
   request it, name it, or read what it produced. It is closer to the payment
   boundary than to `MAP` or `COMPARISON`.

2. **`AUTHENTICATE` is not a capability the DAG executes.** It changes who the
   session belongs to, which is the thing every other authorization check depends
   on. It cannot be a node whose result is a receipt.

---

## 5. Navigation

The owner's position on the bottom navigation, recorded as given:

Preferred:

```text
الرئيسية · المحادثات · [ جاسم ] · النشاط · حسابي
```

Rejected:

```text
الخدمات · السفر · التسوق · السيارات · …
```

> لأن تلك تجعل جاسم يبدو تطبيق خدمات. بينما هو: جاسم واحد.

This is the same ratchet as decision D3 on the commerce branch: a per-domain tab is
a domain branch wearing a navigation costume. The category list may shrink. It may
never grow.

---

## 6. The empty home screen is correct

```text
┌──────────────────────────────┐
│            جاسم              │
│                              │
│    ماذا تريد أن يحدث؟        │
│                              │
│  ┌────────────────────────┐  │
│  │ اكتب ما تريد...        │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

> واجهة جاسم لا تبدأ مليئة بالميزات؛ ميزات جاسم تظهر عندما يستدعيها الهدف.

The marketing image — the one dense with capability cards — advertises what JASIM can
do. The product does not need to, because the person will ask.

**The one thing that may persist:** Living Objects, and only when something is
genuinely live.

```text
نشط الآن
• توصيل الطلب — يصل تقريبًا 6:20
• مراقبة سعر الرحلة — نشطة
```

> لكن إذا لا يوجد شيء: لا نملأ الصفحة لمجرد أنها فارغة.

This is already how `ActiveObjectsRail` behaves — an empty rail renders nothing. The
law confirms that behaviour rather than changing it.

---

## 7. When UI is still the right answer

The law is not "remove the UI". The owner was explicit:

> المحادثة هي لغة التحكم الأساسية. والواجهة هي الأداة المناسبة عندما تصبح المحادثة
> وحدها أقل كفاءة.

| Utterance | Surface |
|---|---|
| «احجز لي موعدًا» | Calendar |
| «قارنهم» | Comparison |
| «أدخل كلمة المرور» | Secure Field |
| «حدد الموقع» | Map / location selector |
| «اختر واحدًا من الأربعة» | Choice |

```text
Conversation = Primary Control Plane
Generated UI = Temporary Interaction Instrument
```

---

## 8. What must never happen

- A password, token, biometric secret or payment credential reaching model context.
- A generated surface that outlives the intent that produced it.
- A permanent traditional screen added because a traditional app would have one.
- A per-domain navigation tab.
- The model or the client selecting a credential-collecting surface.
- An `AUTHENTICATE` or account-deletion intent completing without the confirmation
  strength the law names — impact explanation, re-authentication, confirmation.
- Any of the above justified by "the conversation asked for it". The conversation
  initiates; the runtime authorizes.

---

## 9. Status of this document

Recorded per the owner's instruction that this become a foundational principle. No
code was written for it in this wave. When it is implemented, this document is the
specification, and §3 is the part that may not be traded away for convenience.
