# JASIM — UI EVOLUTION PHASE UI-2

**Branch:** `claude/runtime-experience-wave-1` · **UI-1 baseline:** `3824fa1`
**Production touched:** NO · **Runtime semantics changed:** NO · **Real data added:** NO

---

## 0. I CAN SEE NOW

UI-1 ended at `VISUAL_ACCEPTANCE = NOT YET PROVEN`, and its own report named
that as the largest gap. It is closed.

```
REAL_BROWSER_VISUAL_CAPTURE = YES
BEFORE_SCREENSHOTS = 39      (13 scenarios × 3 viewports)
AFTER_SCREENSHOTS  = 39
```

The path: the **compiled** stylesheet from `dist/assets/`, the **real**
component output from `PresentationRenderer` over `decidePresentation`, the
**real** typeface (Noto Sans Arabic, as the product loads it), rendered in
**headless Chromium via `playwright-core`** at 390 / 834 / 1440 px with
`deviceScaleFactor: 2`, `isMobile`, `hasTouch` and `locale: "ar"`.

The before/after pair is honest: I stashed every UI-2 source change, rebuilt,
and captured `before/` from the UI-1 tree, then restored and captured `after/`.
Same harness, same viewports, same fonts — only the product code differs.

**Everything in §2 was found by looking. None of it was visible in the CSS.**

---

## 1. A MISTAKE WORTH REPORTING FIRST

My first screenshotter was raw `chrome --headless --screenshot`. Every mobile
surface came back clipped on the start edge — titles cut, glyphs off-screen,
body text severed mid-word. It looked like a serious RTL layout failure and I
began fixing it.

It was not real. Raw headless mode screenshots from scroll-x 0 and does not
honour the RTL scroll origin. Under `playwright-core`, measuring
`document.documentElement.scrollWidth` against `clientWidth` in the real layout
engine:

```
OVERFLOW.txt → none — no surface exceeds its viewport
```

All 39 pages, both phases. **There was never a mobile overflow bug.**

I kept the `min-width: 0` hardening that came out of it — it is correct
defensive CSS for flex children — but it fixed nothing, and saying otherwise
would be inventing a victory. The measurement now runs on every capture so this
class of false alarm cannot recur.

---

## 2. WHAT THE PIXELS SHOWED

### 2.1 Three glass panes for one answer

`E-map-fresh` on a phone rendered as **three separately bordered, separately
blurred, separately badged panes** stacked down the screen — parent TRACKER,
child TRACKER, child MAP — for what is one tracking answer. Part 6 names "five
nested glass panels" as the failure; this was three, and it was the default.

`PresentationRenderer` rendered children as *siblings after* the parent. They
now render *inside* it, with the stylesheet stripping each child's border, blur,
shadow and padding. One surface, two parts, separated by a hairline rule.

### 2.2 «التتبّع» twice, one under the other

Parent and child were both `TRACKER`, so both took the same default Arabic
title. A child whose heading only repeats its parent's says nothing by having
one; it is now suppressed.

### 2.3 A badge on every surface saying the same thing

«من الحالة الموثوقة» appeared on all thirteen surfaces — **three times on one
mobile MAP**. Every surface JASIM renders comes from canonical state; that is
the architecture, not a property of any one answer. A badge that is always true
is decoration, and it cost a border and a competing element beside every title.

Removed. Trust is communicated where it *varies*: blocked says blocked, stale
says stale.

### 2.4 A grey box labelled "Map View"

`renderMap` drew a 200px grey rectangle with the English words *Map View* in the
middle, whether or not any position existed. That is the worst rendering of "no
position": it looks exactly like a map that has not finished loading, so a
person waits for something that is never coming.

No tile provider is connected and UI-2 does not connect one. The surface now
shows what JASIM actually knows — the coordinate — or says honestly that there
is none.

### 2.5 The map said it did not know a position it knew

Worse than 2.4 and found the same way. The renderer read `data.coordinates`; the
decision layer emits `data.markers[0].coordinates`. So a **FRESH** observation
*with* a position rendered «لا يتوفّر موقع لعرضه». JASIM claiming not to know
something it knows is the most damaging error possible on a tracking surface.

### 2.6 An empty bordered box

A parent surface whose only job is holding children drew a status pill with
nothing in it: `??` let an empty string through where `||` was needed. A surface
with nothing to say now renders nothing.

### 2.7 «أوافق» and «اختيار» were the same button

Part 12 is explicit: an approval must not be visually equivalent to an ordinary
CHOICE. They were **identical** — the same filled cyan, the most inviting thing
on the screen in both cases. The muscle memory built by picking between two
harmless options carried straight over to authorising an external effect.

Consequential actions are now warning-toned and outlined rather than filled, and
the approval says why it stopped: «لن يُنفَّذ شيء قبل موافقتك».

### 2.8 English in the product

`Select`, `Approve`, `Reject`, `Continue` — action labels hardcoded in
`presentation-fabric.ts`. These are presentation *copy*, not decision logic;
which primitive is chosen is untouched. Now «اختيار»، «أوافق»، «أرفض»، «متابعة».

### 2.9 Internal handles shown as content

Each CHOICE row printed `ref-1` beside its label. That is plumbing, and it is
also the wrong thing to surface: what a person says next turn is «الثاني». Rows
now carry an ordinal badge; the handle travels in `data-reference` where the
dispatcher reads it and nobody else does.

### 2.10 A fixture that had rotted

`E-map-fresh` pinned `2026-01-01`. Nine months on, the screenshot read
**«مشاهدة حديثة · قبل ٩ أشهر»** — the surface contradicting itself, and me about
to judge a freshness design against a fixture that had quietly gone stale.
Fixtures are now relative to now.

### 2.11 A defect I introduced, then caught

My mobile rule `.jasim-action { flex: 1 1 auto }` — meant so two buttons sit
side by side within thumb reach — turned the lone «اختيار» into a 340px cyan bar:
the loudest object on the phone, for the cheapest action on it, directly beneath
two options that are themselves tappable. Caught in the after-capture, before
the report. A single action no longer stretches, and a choice's footer action is
secondary to the options.

---

## 3. BEFORE → AFTER

`docs/ui/evidence/ui2/{before,after}/` — same filenames, comparable directly.
The set deliberately includes error, blocked, stale and empty, not only the
attractive states.

| Scenario | before | after |
|---|---|---|
| `D-ambiguous-choice` | `ref-1` / `ref-2` shown, English **Select**, trust chip, static rows | ordinals, «اختيار» secondary, tappable rows, no handles |
| `E-map-fresh` (mobile) | 3 panes, «التتبّع» twice, 3 trust chips, "لا يتوفّر موقع" | 1 pane, 1 title, real coordinate, honest provider note |
| `G-approval-required` | **Approve** in the same cyan as Select | «أوافق» warning-toned + why-it-stopped line |
| `K-provider-unavailable` | blocked, plus a trust chip | blocked, `role="alert"`, no badge |
| `A-plain-conversation` | already chromeless from UI-1 | unchanged |

---

## 4. WHAT I DID **NOT** DO

- **The application shell is not captured.** Sidebar, composer, workspace column
  and Living Objects rail need the running app with an authenticated session and
  seeded canonical rows. The harness renders one surface on the page background.
  So Part 4 (conversation dominance), Part 8 (composer) and Part 13 (Living
  Objects weight) are judged from **code and proportion**, not from pixels —
  exactly the standard UI-2 exists to raise. They are marked `PARTIAL` for that
  reason and nothing else.
- **Mobile is not captured.** Metro cannot run here.
- No Maps provider, no Gemini, no payments, no ads, no domain navigation, no
  `SchemaRenderer` rewrite, no `artifacts/jasim` revival.

### Legacy domain components (Part 22)

Classified, not touched: `JobCard`, `ProductCard`, `MerchantCard`,
`MurabahaDisplay` and ~40 siblings in `src/components/` are **UNREACHABLE** —
not imported by `Home.tsx` or anything under `jasim-core`. Not used for new
work, not redesigned, not deleted. Verified cleanup stays a separate scheduled
task.

---

## 5. TESTS AND PERFORMANCE

| Suite | Result |
|---|---|
| Main suite | **1203 / 1203** (+6 skipped: live-model gate + visual capture gate) |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** |
| `tsc -b` | **PASS** |
| Web build | **PASS** (5.25s) |
| Mobile TypeScript | **10** — pre-existing, unchanged |

**No inherited test was modified in UI-2.** Ten new assertions pin each defect
in §2 so it cannot come back.

| | UI-1 | UI-2 | Δ |
|---|---|---|---|
| JS | 866,864 B | 868,452 B | **+1.6 kB (+0.2%)** |
| CSS | 175,239 B | 178,372 B | **+3.1 kB (+1.8%)** |

`PERFORMANCE_REGRESSIONS = 0`. Compositing cost went **down**: removing the
nested panes eliminates two `backdrop-filter` layers per tracking surface, which
is the single most expensive thing on the screen.

The capture itself is gated behind `JASIM_VISUAL_CAPTURE` — an ordinary test run
never launches a browser.

---

## 6. WHAT A REVIEWER SHOULD DOUBT FIRST

1. **The shell is still unseen.** Three of the brief's parts are judged from
   code. That is the honest ceiling of a component-level harness, and it is why
   this phase is `PARTIAL`.
2. **One surface at a time.** A conversation is a *column* of surfaces; density
   and rhythm between consecutive answers cannot be judged from thirteen
   isolated shots.
3. **Contrast is judged by eye, not measured.** No automated WCAG ratio check
   runs. `--jasim-text-secondary` was raised in UI-1 by reasoning, and UI-2 did
   not verify it with a number.
4. **`playwright-core` is a new dev dependency.** Dev-only, no browser download
   (it uses the pre-installed Chromium), but it is a new entry in the lockfile.
5. **The `:has()` selector** used to make a choice's action secondary is
   unsupported in older browsers; the fallback is the ordinary primary button,
   which is louder than intended but not broken.
6. **I nearly shipped a fix for a bug that did not exist** (§1). The lesson is
   in the harness now — overflow is measured, not eyeballed — but it is worth
   knowing that the first pass of real-pixel review produced a false positive
   before it produced a true one.

---

## 7. COUNTERS

```
UI_PHASE_UI2                        = PARTIAL

REAL_BROWSER_VISUAL_CAPTURE         = YES
BEFORE_SCREENSHOTS                  = 39
AFTER_SCREENSHOTS                   = 39

CONVERSATION_VISUALLY_PRIMARY       = PARTIAL   (shell not captured — §4)
PREMIUM_VISUAL_SYSTEM               = PASS
ARABIC_TYPOGRAPHY                   = PASS
RTL_VISUAL_ACCEPTANCE               = PASS      (verified at 3 viewports, 0 overflow)
COMPOSER_UX                         = PARTIAL   (shell not captured)
CHOICE_VISUAL_UX                    = PASS
MAP_VISUAL_UX                       = PASS
STATUS_TRUTHFULNESS                 = PASS
APPROVAL_UX                         = PASS
LIVING_OBJECTS_VISUAL_WEIGHT        = PARTIAL   (shell not captured)
MORPHING_VISUAL_UX                  = PARTIAL   (static capture cannot show motion)
ACCESSIBILITY_VISUAL                = PARTIAL   (contrast not measured — §6.3)

PERFORMANCE_REGRESSIONS             = 0
DOMAIN_SPECIFIC_UI_COMPONENTS_ADDED = 0
FAKE_PRODUCTION_DATA_ADDED          = 0
CANONICAL_STATE_MOVED_TO_CLIENT     = NO
ARCHITECTURE_FREEZE_VIOLATIONS      = 0

MAIN_SUITE                          = 1203 / 1203 (+6 skipped)
BLOCK_2                             = 101 / 101
BLOCK_3                             = 133 / 133
BLOCK_3_1                           = 65 / 65
TYPECHECK                           = PASS
WEB_BUILD                           = PASS
MOBILE_BUILD                        = 10 PRE-EXISTING TS ERRORS (unchanged); Metro BLOCKED_BY_ENVIRONMENT

READY_FOR_FINAL_PRODUCT_UI_POLISH   = YES
```

`PARTIAL` because half the brief — the assembled application shell — is still
unseen. The half that could be seen was reviewed properly, and it contained ten
real defects that no amount of reading the CSS would have found.

END OF UI-2 REPORT.
