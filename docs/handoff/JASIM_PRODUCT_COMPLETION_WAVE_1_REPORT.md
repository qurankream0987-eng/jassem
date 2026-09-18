# JASIM — PRODUCT COMPLETION WAVE 1 · REPORT

**Date:** 2026-09-18 · **Branch:** `claude/runtime-experience-wave-1` · **Commit:** `f79b741`
**Visual evidence:** `docs/ui/wave1-after/` (before: `docs/ui/current-approved/`)

The product shell was accepted as the JASIM 1.0 visual baseline and was **not**
redesigned. Architecture Freeze remained ACTIVE throughout.

---

## 1. The six observed defects

| # | Defect | Fix | Proof |
|---|---|---|---|
| 1 | «جاسيم» — the product's own name misspelled on the welcome screen | `JasimChat.tsx` | `A-empty.desktop.png` reads «مرحباً بك في جاسم» |
| 2 | Every conversation titled «محادثة جديدة» — fourteen identical sidebar rows | `api/runtime/conversation-title.ts`, derived server-side | after-capture sidebar reads «اعرض لي السائق» |
| 3 | «You» in an Arabic-first product | `ChatMessage.tsx` → «أنت» | `MEASURED.txt`: before `| You |`, after `| أنت |` |
| 4 | «Shift + Enter لسطر جديد» shown to people holding a phone | `use-pointer-capability.ts` | phone composer bottom 801 → **824**; hint absent from the after text |
| 5 | Stale sidebar after a failed turn | `useJasimChat.ts` invalidates both queries | main suite |
| 6 | Mobile forced `https://${EXPO_PUBLIC_DOMAIN}` — dev runtime unreachable | `lib/runtime-endpoint.ts` | see §3 |

### Why the runtime owns the title

The title is derived server-side, once, from the conversation's own first user message.
Web, iOS and Android are projections of one runtime; a title computed per client would
differ per device, and two devices disagreeing about what a conversation is called is
the same class of bug as two devices disagreeing about what happened in it. It needs no
model, so history stays usable with no provider configured. And it **cannot fabricate**
— the title is a truncation of what the person actually wrote, never a summary.

---

## 2. Spacing — measured, then fixed

Every dimension in the empty state was a constant, so the block that is correctly
proportioned on a phone became an island on anything larger.

```
                 island width   of column    empty above / below
  390×844    →      358px         91.8%          162 / 175      unchanged
  834×1112   →      407 → 512     74.6 → 86.2%   357 / 370      unchanged
  1440×900   →      407 → 672     35.4 → 58.3%   251/264 → 269/173
```

Sidebar: a constant 288px — 20% of a 1440 desktop, **34.5%** of an 834 tablet. Below
`lg` it is 240px (28.8%), returning 48px to the conversation column (546 → 594). Titles
already truncate, so the cost is a few characters. Desktop is unchanged.

**A correction made during the work.** The first attempt biased the vertical centring at
`sm:` and above, on the theory that the gap between the suggestions and the composer
was the defect everywhere. The tablet capture showed the block had visibly *sunk* in a
1112px-tall portrait screen. The bias was rescoped to `lg` only — the vertical
complaint was desktop-specific, and the tablet complaint was the sidebar.

---

## 3. The mobile endpoint rule

Four call sites built the URL themselves. A rule enforced in three of four modules is
not enforced, so one resolver now owns it and the others call in.

```
Production is HTTPS. Always. No flag, no override, no env var.
Development may use HTTP, and ONLY to a local address.
```

The second half matters as much as the first: "dev builds may use http" alone would let
a debug build talk plaintext to a real host over a real network, and a bearer token
travels on the very first request.

**Proven in a real Expo production export** (`__DEV__ === false`, verified in the
running page) configured with `EXPO_PUBLIC_DOMAIN=http://127.0.0.1:5731`:

```
DEV flag                  false
API requests attempted    []      ← the plaintext request never left the device
On screen                 لم تُضبط وجهة الخادم لهذا التطبيق. تواصل مع المسؤول.
```

The shipped bundle contains `"A production build refuses a plaintext runtime endpoint"`
and does **not** contain `"A development build may use http only for a local runtime
address"` — `__DEV__` is statically false, so the minifier removed the development
branch. A production build *cannot* take the HTTP path; it does not merely decline to.

29 unit tests pin both halves plus the ambiguous case (no scheme → HTTPS), the empty
case, the user-safe message, and that no other module builds a runtime URL.

---

## 4. The generic ordinal gap

### The gap, before it was filled

Three ordinal parsers already existed, each owned by one feature:

| Where | Vocabulary | Scope |
|---|---|---|
| `research-composition.ts` | الأول…الثامن | research sources only |
| `block31/conversation-orchestrator.ts` | الأول…الخامس | its own flow |
| `jasim-runtime.ts` | «الثاني» | the generic resolver |

So the **generic** resolver understood one word. Worse, `referenceCuePattern` contained
no ordinal at all, so «قارن الثاني والرابع» returned `not_requested` — the runtime did
not fail to resolve the reference, it never registered that one had been made.

### Two corrections, not one

1. **A position is a position in what was shown.** The old line resolved «الثاني» as
   `ranked[1]` — index one of a list sorted by the runtime's own semantic score. That
   answers a different question, and substitutes the runtime's second-best guess for the
   person's instruction at high confidence.

2. **Out of range is unresolved, never the nearest item.** «الخامس» against a list of
   three is a question the runtime cannot answer. Clamping would make it a confident
   wrong one. And one bad position fails the *whole* request: answering about «الثاني»
   alone when «الثاني والتاسع» was asked drops half the request with nothing to show it.

### Vocabulary

الأول…العاشر (both hamza spellings, both genders, with or without the article) ·
الأخير · الذي قبله / التي قبلها / ما قبل الأخير · first…tenth · 1st…10th · last ·
final · penultimate · «رقم ٣» / «العنصر 7» / «position 5» — and Arabic-Indic digits.

«السابق» is **deliberately excluded**: it already means "the previous thing" to the
recency path, and redefining a live word would change answers nobody asked to change.

Two Arabic-specific corrections were needed during the work:
- **Proclitics.** «قارن الثاني والرابع» contains «والرابع», not « الرابع». A lookbehind
  demanding a non-letter read the fourth item as absent.
- **Overlap.** «ما قبل الأخير» contains «الأخير»; «second to last» contains both
  «second» and «last». Without span suppression the parser answered "the one before the
  last, and also the last" — including the item explicitly ruled out.

**No commerce routing was reused or expanded.** The commerce branch is untouched, and
the ratchet (7 branches, 6 labels) is unchanged. The three existing feature parsers were
deliberately left alone: delegating their vocabularies would have widened two
subsystems the wave was told not to touch. **That duplication remains and is named here
as follow-up work.**

---

## 5. Evidence

| Suite | Result |
|---|---|
| Main | **1463 passed**, 26 skipped, 72 files |
| Block 2 | **121 passed** |
| Block 3 | **133 passed** |
| Block 3.1 | **115 passed**, 20 files |
| Frozen evaluation | **74 passed** — benchmark definition unmodified |
| `tsc -b` (solution) | clean |
| `tsc --noEmit` (mobile) | clean |
| `vite build` | clean |
| `expo export --platform web` | clean |
| Visual capture | 3 viewports × 2 states + 2 native, overflow 0 everywhere |

New tests: 29 (mobile endpoint) + 75 (ordinal vocabulary) + 14 (ordinals on the live
path, real proof database) = **118**.

No test was weakened, skipped or quarantined. No PASS was manufactured.

---

## 6. Constraints held

- No secret committed; no credential reached Web, Mobile, Presentation, logs, model
  prompts or this report. Names only.
- Production DB untouched; nothing deployed; no real money; no Real Discovery provider,
  Maps, Delivery or PSP started.
- No authentication weakened, no anonymous privileged session, no test-only bypass, no
  development backdoor, no middleware weakened. The capture authenticates through the
  product's own `/api/runtime/session`, whose dev-token branch is pre-existing and
  fail-closed in production.
- `DOMAIN_SPECIFIC_CORE_ADDED = 0` · `NEW_DOMAIN_BRANCHES = 0` · `FALSE_SUCCESS = 0`
- Architecture Freeze ACTIVE. GoalSpec not started.
- The frozen benchmark definition was not modified.

---

## 7. Open, named honestly

1. **Three feature-local ordinal parsers remain** alongside the new generic one. Folding
   them in is safe but touches the commerce path this wave was told to leave alone.
2. **Ordinals resolve only against enumerations the runtime wrote as ordered arrays**
   (`output.sources`, `output.images`). A bubble or a task was never numbered on screen,
   so «الثالث» correctly does not resolve to one. When other surfaces start enumerating,
   they must record a position for an ordinal to reach them.
3. **Accidental credentials in chat** (00F §3.1) — the owner deferred this explicitly.
   Wave 1's derived titles are a second place such text would land, and whatever closes
   it must cover the title derivation as well as the model call.
4. **The tablet empty state is still 74% vertical whitespace.** The island grew and the
   sidebar shrank, but a 251px block in a 977px portrait column is inherent to the
   aspect ratio. Fixing it means deciding what a tall screen should show that a phone
   should not — a product question, not a spacing one.
