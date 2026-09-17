# JASIM — UI EVOLUTION PHASE UI-1

**Branch:** `claude/runtime-experience-wave-1` · **Baseline:** `9302a80` (Wave 2.1)
**Production touched:** NO · **Runtime/architecture changed:** NO · **Real data added:** NO

---

## 0. THE CORRECTION THAT CAME FIRST

The brief named `artifacts/jasim` as the active Web app. It is not.

| | `canonical/جاسم/app/src` | `artifacts/jasim` |
|---|---|---|
| Conversation shell | `JasimChat`, `ChatSidebar`, `ChatInput` | — |
| Generated surfaces | `PresentationRenderer` → all 40 primitives; `SchemaRenderer` (1502 lines) | **none** |
| Active workspace | `ActiveGenerativeWorkspace`, morphing, `ActiveObjectsRail` | — |
| Language | Arabic (partly) | English, LTR, `JASIM.RUNTIME` / `SYS.ONLINE` |
| Test coverage | 8 test files | — |
| Served with the API | yes | separate app |

`replit.md` describes `artifacts/jasim` literally as the *"web runtime operator
interface"* — a console, not the product. Following the brief's path would have
meant rebuilding the entire generative UI from zero in an app that has none of
it, duplicating ~5,100 tested lines, and abandoning the one that works.

I asked before writing code, and the answer was to evolve
`canonical/جاسم/app/src`. `artifacts/jasim` was left untouched.
`artifacts/jasim-mobile` was correct as named.

---

## 1. PART 1 — WHAT THE CURRENT UI ACTUALLY DID

The inventory was taken by rendering the real components against the real
decision layer, not by reading code. Thirteen canonical scenarios, captured as
`docs/ui/evidence/before/`. What came back was worse than the code suggested.

### 1.1 Every surface claimed to be verified — including the failures

`PresentationRenderer` hardcoded `trust: { level: 'verified', verified: true }`
for **every** presentation. So a provider-unavailable surface shipped like this:

```html
<h2>JASIM presentation</h2>
<div>verified</div><div class="bg-emerald-500/20 text-emerald-400">Verified</div>
```

A blocked state, wearing a green success chip. **13 of 13** surfaces carried it.
Nothing about it was true: a valid presentation *contract* is not a verified
*outcome*, and Part 19 names this exact failure.

### 1.2 Every surface was titled "JASIM presentation"

An English placeholder headed all 13, errors included.

### 1.3 CHOICE rendered nothing

```html
<div class="grid gap-2"></div>
<button>Select</button>
```

`decidePresentation` emits the option set as `data.candidates`; `renderChoice`
reads `data.options`. Nothing bridged them. **The ambiguity → CHOICE flow proved
at the runtime level in Wave 1.2 was invisible on the web** — an empty box and a
button that selected nothing.

### 1.4 One sentence of conversation was a 24px-padded glass card

809 bytes of markup — border, blur, heading, two badges — to say one sentence.
Five replies produced five competing cards.

### 1.5 The conversation was the minority of the screen

```
lg:w-[min(62vw,47rem)]   ← workspace + Living Objects rail
```

The generated surface and the rail took ~62% of a desktop viewport. The
conversation — the thing the product *is* — got what was left.

### 1.6 The responsive layout never responded

```ts
useState(() => { ...; window.addEventListener('resize', checkMobile); return () => ... });
```

Written as `useState` rather than `useEffect`: the body ran once as a lazy
initialiser, the listener was never registered, and the cleanup function was
stored **as state**. `isMobile` was computed once and never again.

### 1.7 Accessibility

- `body { overflow: hidden; touch-action: none; }` — pinch-zoom blocked outright.
- No `:focus-visible` anywhere; the reset removed outlines and nothing replaced them.
- No `prefers-reduced-motion`; every animation ran unconditionally.
- Status conveyed by colour alone.
- 10px and 11px type for timestamps, chips, hints and dividers — in Arabic.

### 1.8 RTL was a decoration, not a direction

Sixteen `dir="rtl"` attributes on leaf nodes, while the layout underneath ran
left-to-right: sidebar at `left-0`, `.message-group.user { margin-left: auto }`,
`.msg-time { margin-right: auto }`.

### 1.9 Mobile could not render a Living Object

`MOBILE_PRESENTATION_REGISTRY` had no `SMART_BUBBLE` entry, which is what
`decidePresentation` emits for any persistent operation. Durable monitors
rendered on the web and fell through to "unsupported" on the device where people
actually watch long-running things.

---

## 2. WHAT CHANGED

### 2.1 One token source (Part 15)

`lib/jasim-design-tokens/tokens.ts` — semantic names (`surface.glass`,
`status.blocked`, `duration.surface`), not literal ones. Web consumes CSS custom
properties, Mobile a TypeScript object, and **a test asserts the two forms
agree**, so the platforms cannot drift apart unnoticed. Before, each maintained
its own hand-copied palette with no mechanism at all.

`status.blocked` exists as a token distinct from `warning` because a blocked
operation is not a caution — it is a stop.

`--jasim-text-secondary` was raised from `#94a3b8` to `#b6c2da`. The old value
cleared 4.5:1 against pure black but fell under it on a lit glass surface, which
is where secondary text is actually drawn.

### 2.2 A surface is a pane, and only when it earns one (Parts 3, 24)

| | before | after |
|---|---|---|
| Plain conversation | 809 B — card, heading, 2 badges | **260 B — the sentence** |
| Approval | 1379 B | 1182 B |
| Completed operation | 1149 B | 970 B |
| Living object | 790 B | 621 B |
| **Ambiguous → CHOICE** | 855 B, **zero options** | **2532 B, both options** |

The glass pane is reserved for surfaces that are doing something. A plain answer
is plain.

### 2.3 Truth (Parts 13, 19)

| | before | after |
|---|---|---|
| `JASIM presentation` placeholder title | 13 / 13 surfaces | **0** |
| Green "Verified" badge | 13 / 13 surfaces | **0** |
| Blocked state marked as blocked | no | `data-tone="blocked"` + `role="alert"` |

`src/lib/runtime-state-copy.ts` translates the runtime's own vocabulary —
`MODEL_GATEWAY_UNAVAILABLE`, `BLOCKED_BY_PROVIDER`, `MISSING_GENERIC_CAPABILITY`,
`INCONCLUSIVE`, `STALE` — into Arabic with three parts: what happened, what you
can do, and how it should look. An unknown code returns `undefined` rather than
a reassuring default, because a default is how a product ends up saying
"حدث خطأ ما" about six genuinely different situations.

`INCONCLUSIVE` gets the sentence it deserves: **«لا تفترض النجاح»**.

Provider unavailable, after:

```html
<div class="jasim-state" data-tone="blocked" role="alert">
  <span class="jasim-state-icon" aria-hidden="true">■</span>
  <p class="jasim-state-label">المزوّد المطلوب غير متاح</p>
  <p class="jasim-state-detail">لم يتم أي إجراء خارجي. سيبقى الطلب كما هو حتى يتوفّر المزوّد.</p>
</div>
```

### 2.4 Freshness reads as freshness (Part 25 E/F)

`FRESH` / `STALE` were bare English tokens in neutral grey. Now: **«مشاهدة حديثة»**
with a ✓ in the success tone, **«مشاهدة قديمة»** with a ◷ in the stale tone, and
the ISO timestamp replaced by `Intl.RelativeTimeFormat('ar')` — with the absolute
value kept in `title` for anyone who needs it. A test asserts the stale surface
renders no coordinates.

### 2.5 Conversation-first, as a proportion (Parts 4, 11)

| | before | after |
|---|---|---|
| Workspace column | `62vw / 47rem` | **`38vw / 32rem`** |
| Living Objects rail | `22vw / 16rem` | **`13vw / 11rem`** |
| Conversation | ~38% | **~62%** |

No service grid, no category launcher, no dashboard tiles — asserted by test.

### 2.6 RTL as a direction (Parts 12, 14)

`dir="rtl" lang="ar"` at the root, once. Physical-side rules replaced with
logical properties (`margin-inline-start`, `inset-y-0 start-0`) and the old
declarations **deleted** rather than overridden. The type floor is 12px.

### 2.7 Accessibility (Part 17)

- `@media (prefers-reduced-motion: reduce)` — transitions collapsed, not
  removed, so state changes stay perceptible.
- One global `:focus-visible` rule, so it cannot be forgotten per component.
- 44px minimum touch target on every action.
- Gesture lock removed; pinch-zoom works.
- `role="status"` + `aria-live="polite"` on waiting states; `aria-hidden` on glyphs.
- **No status is colour-only** — glyph, then words, then tone. Asserted by test.

### 2.8 Waiting states that say what they are waiting for (Part 18)

Six distinct states — understanding, searching, waiting for provider, awaiting
approval, running, blocked — replacing a four-block skeleton grid that implied a
shape of result nobody knew yet. **No completion ratio anywhere**: real
measurable progress exists only for a durable Run with counted nodes.

### 2.9 Mobile (Part 10)

`SMART_BUBBLE → 'entity'` closes the Living Object gap. The registry still fails
closed for `WORKSPACE`, `EXTERNAL_ACTION` and `CHAT` — asserted. Tokens aligned
to the shared source.

---

## 3. EVIDENCE (Part 26)

`docs/ui/evidence/before/` and `docs/ui/evidence/after/` — 13 scenarios × 2
platforms, produced by running the **real decision layer** through the **real
components**. Not hand-written fixtures: if the decision cascade changes, these
change with it.

**This is rendered markup, not screenshots.** No browser-driven capture is wired
for this app here and Metro cannot run in this environment. Markup catches
structure, text, semantics, ARIA and class names; it does **not** catch contrast
as rendered, spacing, or motion. Every claim in this report is about something
markup can show. The visual half is genuine remaining debt, listed in §7.

---

## 4. TESTS

`tests/unit/ui-evolution-ui1.test.tsx` — 41 assertions turning the Part 27
review into rules that keep holding: token single-source, zero domain
components, zero fake data, no hardcoded coordinates in shipped source, no
placeholder title, no false verified badge, blocked ≠ empty ≠ success, stale
renders no position, CHOICE renders its options, plain text is not a card,
conversation-first proportions, RTL logical properties, reduced motion, focus
visibility, touch targets, no colour-only status, no fabricated progress,
Web/Mobile parity.

### Three inherited tests were updated — disclosed in full

| Test | Change | Why |
|---|---|---|
| `smart-ui-task-3-renderer` ×3 | asserted the English sentence *"blocked because its runtime contract was invalid"* → now asserts `data-testid="presentation-blocked"` | The notice is Arabic now. The marker is what the test was really about, and it is immune to the next copy edit. The unsupported-action case gained **two new assertions** (the intent and label never reach the DOM). |
| `smart-ui-task-4b-workspace` ×1 | same string → same marker | as above |
| `smart-ui-task-6b-rail` ×1 | pinned `lg:w-[min(22vw,16rem)]` → `lg:w-[min(13vw,11rem)]` | The rail was narrowed on purpose. The assertion still pins a narrow desktop layout hook — a narrower one. |

**No assertion was weakened; one case was strengthened.**

---

## 5. PERFORMANCE (Part 21)

| | before | after | Δ |
|---|---|---|---|
| JS bundle | 860,670 B | 866,864 B | **+6.2 kB (+0.7%)** |
| CSS bundle | 173,598 B | 175,239 B | **+1.6 kB (+0.9%)** |
| Build time | 8.64 s | 7.81 s | — |

No visual library was added. The growth is the token block, the surface system
and the Arabic copy table.

Blur cost was addressed rather than ignored: `backdrop-filter` is applied only
to surfaces marked `data-glass`, and an `@supports not` fallback paints an
opaque surface where the browser cannot composite it — so text never lands over
moving content on a device that cannot afford the blur.

`PERFORMANCE_REGRESSIONS = 0`.

---

## 6. WHAT WAS DELIBERATELY *NOT* COPIED FROM THE REFERENCE

The image shows, inside one phone: three laptops with prices and star ratings, a
car with a valuation, a map with a driver 2.4 km away, three job listings with
company names, a comparison verdict, and a built platform — all at once.

None of it is real, and **none of it was added**. The image is marketing
storytelling; the product renders whatever canonical state exists and an honest
empty or unavailable surface when none does. Its `الخدمات` category tab was
likewise not copied: JASIM must never ask which application you want before
asking what you want to happen.

`FAKE_PRODUCTION_DATA_ADDED = 0` · `DOMAIN_SPECIFIC_UI_COMPONENTS_ADDED = 0`,
both asserted by test across web and mobile source.

---

## 7. WHAT A REVIEWER SHOULD DOUBT FIRST

1. **No pixels were seen.** Every claim rests on rendered markup. Contrast as
   actually composited, spacing rhythm, and whether the glass reads as premium
   or as murky are all unverified. This is the single largest gap and the
   obvious first task for UI-2.
2. **`SchemaRenderer` is 1502 lines and UI-1 touched perhaps 15% of it.** The
   surfaces in the twelve scenarios are fixed; renderers outside them
   (`renderWizard`, `renderGallery`, `renderDashboard`, `renderFilter`, …) still
   carry English labels, `text-[11px]`, and hardcoded slate colours.
3. **The legacy `src/components/` domain residue is untouched** — `JobCard`,
   `ProductCard`, `MerchantCard`, `MurabahaDisplay` and ~40 more still exist.
   They are not reachable from `Home.tsx`, and the no-domain-components test
   covers `jasim-core`, `src/lib` and the mobile app — not that older directory.
   Deleting it was out of scope under the architecture freeze.
4. **Mobile was changed less than Web.** One registry entry and the token
   alignment. The mobile renderer was already the better of the two; it did not
   need the same repair, but it also did not receive the same attention, and
   `MOBILE_BUILD` remains 10 pre-existing TypeScript errors with Metro
   unrunnable here.
5. **Morphing was reviewed, not rebuilt.** `useWorkspacePresentationTransition`
   and `workspacePresentationVisual` already implement ENTER/UPDATE/MORPH/EXIT/
   NO_CHANGE correctly, keyed so UPDATE does not replay the scene and MORPH does
   not stack two surfaces. UI-1 aligned the duration token to
   `WORKSPACE_EXIT_DURATION_MS` (asserted) and changed nothing else.
   `MORPHING_UX` is marked PASS on that basis — inherited, not built here.
6. **`--jasim-text-secondary` was raised by judgement, not by measurement.** The
   old value was computed against pure black; the new one is a reasoned estimate
   for a lit glass surface. A real contrast measurement needs a rendered pixel.

---

## 8. COUNTERS

```
UI_PHASE_UI1                       = PARTIAL

CONVERSATION_FIRST                 = PASS
WEB_VISUAL_EVOLUTION               = PARTIAL
MOBILE_VISUAL_EVOLUTION            = PARTIAL
GENERATIVE_SURFACES                = PASS
MORPHING_UX                        = PASS (inherited; token aligned, not rebuilt)
LIVING_OBJECTS_UX                  = PASS
MAP_UX                             = PASS
CHOICE_UX                          = PASS (was broken — rendered zero options)
RTL                                = PASS
ACCESSIBILITY                      = PARTIAL

PERFORMANCE_REGRESSIONS            = 0
DOMAIN_SPECIFIC_UI_COMPONENTS_ADDED = 0
FAKE_PRODUCTION_DATA_ADDED         = 0
CANONICAL_STATE_MOVED_TO_CLIENT    = NO
ARCHITECTURE_FREEZE_VIOLATIONS     = 0

MAIN_SUITE                         = 1193 / 1193 (+5 skipped, live-model gate)
BLOCK_2                            = 101 / 101
BLOCK_3                            = 133 / 133
BLOCK_3_1                          = 65 / 65
TYPECHECK                          = PASS (tsc -b)
WEB_BUILD                          = PASS (7.81s)
MOBILE_BUILD                       = 10 PRE-EXISTING TS ERRORS (unchanged); Metro BLOCKED_BY_ENVIRONMENT

READY_FOR_UI_PHASE_UI2_POLISH      = YES
```

**`UI_PHASE_UI1 = PARTIAL`, and PARTIAL is the honest answer.** The structural,
semantic and truthfulness work is done and proven. The *visual* half — whether
this now looks like the reference — is the half I could not see, and calling it
PASS would be claiming an improvement I cannot show. §7.1 is where UI-2 starts.

`ACCESSIBILITY = PARTIAL` for the same reason: the mechanisms are in place and
tested; measured contrast and a real screen-reader pass are not.

END OF UI-1 REPORT.
