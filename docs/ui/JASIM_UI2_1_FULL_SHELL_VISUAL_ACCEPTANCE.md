# JASIM — UI-2.1: FULL AUTHENTICATED PRODUCT SHELL VISUAL ACCEPTANCE

**Branch:** `claude/runtime-experience-wave-1` · **UI-1:** `3824fa1` · **UI-2:** `74113c9`
**Production DB touched:** NO · **Auth weakened:** NO · **Fake data added:** NO

---

## 0. THE GAP IS CLOSED

UI-2 proved generated surfaces in a real browser but could not assemble the
product. That is done: the **real `Home.tsx`**, with the real `ChatSidebar`,
`JasimChat`, `ChatInput`, `ActiveGenerativeWorkspace`, `ActiveObjectsRail` and
`RuntimeBubbleLayer`, authenticated, in Chromium, at three viewports.

```
REAL_AUTHENTICATED_PRODUCT_CAPTURE = YES
REAL_PRODUCT_COMPONENTS_USED       = YES
```

### How authentication was obtained

The product's **own** `/api/runtime/session` endpoint, unmodified. It issues a
dev token only when `NODE_ENV !== "production"`; in production it requires a
valid session cookie and returns 401 without one. That fail-closed branch
already existed — **nothing was added, nothing was weakened**. The token is set
as the ordinary `jasim_session` cookie, so the browser authenticates by exactly
the path a person does.

```
PRODUCTION_AUTH_BYPASS_ADDED = NO
PRODUCTION_DATABASE_TOUCHED  = NO
```

Isolated local Postgres. The conversation list shows rows left by earlier waves'
own probes (`wave12`, `probe`) — this environment's data, not production's, and
not invented for a screenshot.

---

## 1. WHAT THE ASSEMBLED SHELL LOOKED LIKE

Eight defects. **Every one of them needed the whole product on screen.** Not one
was visible in a component screenshot, and not one was visible in the CSS.

### D1 — On a phone, the sidebar covered the conversation

`sidebarOpen` defaulted to `true` and `isMobile` to `false`, with the viewport
check in an effect. First paint on a 390px screen put the conversation *list* on
top of the conversation itself.

**Fix:** both initialise from the real viewport; crossing the breakpoint closes
an overlay sidebar instead of leaving it covering the conversation.
`before/A-empty.mobile.png` → `after/A-empty.mobile.png`.

### D2 — A third of the desktop was reserved for nothing

`ActiveGenerativeWorkspace` returns `null` without a conversation, but Home
still claimed `38vw` for its column. The empty state was a centred conversation
with a third of a 1440px screen held black beside it.

**Fix:** the column is only reserved when there is a conversation for it to be
about. `before/A-empty.desktop.png` → `after/A-empty.desktop.png`.

### D3 — The shell was navy; the surfaces were near-black

Generated surfaces used the UI-1 tokens. The shell around them used
`bg-slate-950`, `bg-slate-900/80`, `border-slate-800` — a different, bluer
palette. Side by side they read as two products.

**Fix:** shell surfaces point at `--jasim-bg`, `--jasim-surface-opaque`,
`--jasim-border`.

### D4 — The sidebar stopped halfway down the screen

No height on the panel, so it collapsed to its content and left a hard edge at
~550px with bare page below it.

**Fix:** `h-full min-h-0` on the panel and its wrapper.

### D5 — The product was in English

The whole shell: *Conversations*, *Search…*, *Welcome to JASIM*, *Your unified
generative executable agent…*, all four suggestions, *New Conversation*, *Just
now*, the footer.

The cause is worth stating precisely: **the Arabic already existed.**
`JasimChat` and `ChatInput` carry `rtl ? 'عربي' : 'English'` throughout — and
`rtl` defaulted to `false` with nothing ever passing it. In an Arabic-first
product Arabic is the default, not the alternative.

`ChatInput` had the same shape one level deeper: `detectRtl('')` is `false`, so
an **empty** field was treated as an English field and the composer hint shipped
in English beneath an Arabic placeholder.

**Fix:** `rtl` defaults to `true`; an empty composer stays Arabic and still
follows what the user actually types; the sidebar's hardcoded strings are
translated.

### D6 — `<html>` had no direction

Measured: `dir: null`. Direction was set on Home's root `<div>`, so the
*document* was still LTR — scrollbar side, native controls and selection
behaviour all follow the document.

**Fix:** `<html lang="ar" dir="rtl">`. The page title and description were also
still the old marketplace copy; both replaced.

### D7 — A blocked turn leaked an environment variable to the user

The most serious finding, and it needed a **real turn through the real
composer** to surface. With no model provider configured, this went into the
conversation verbatim:

> No model service is configured. Configure JASIM_MODEL_PROVIDER with its
> provider API key before creating a task.

English, addressed to an operator, naming an environment variable to somebody
who will never set one. UI-1 built the Arabic vocabulary for exactly this state;
nothing routed this path through it.

**Fix:** `src/lib/runtime-error-copy.ts` maps the runtime's normalized **codes**
(not its prose, which would break on the first rewording) onto the UI-1 copy.
An unrecognised error gets an honest sentence — something failed, nothing was
saved — and never an invented cause. The raw text goes to the console, where an
environment variable name belongs.

The same turn now reads:

> **تعذّر الوصول إلى نموذج الذكاء. لم يُحفَظ شيء. يمكنك إعادة المحاولة بعد قليل.**

`after/G-after-turn.{mobile,tablet,desktop}.png`.

### D8 — Suggestion labels in English

`ChatSuggestions` is a second, separate list from the empty state's. Translated.

---

## 2. MEASURED, NOT EYEBALLED

From `after/MEASURED.txt`, taken in the real layout engine:

| | mobile 390 | tablet 834 | desktop 1440 |
|---|---|---|---|
| `scrollWidth` vs viewport | 390 / 390 | 834 / 834 | 1440 / 1440 |
| `<html dir>` | `rtl` | `rtl` | `rtl` |
| Composer visible | yes | yes | yes |
| Composer placeholder | «اكتب ما تريد أن يحدث…» | same | same |
| Blurred (composited) layers | **2** | 3 | 3 |

```
UNINTENDED_HORIZONTAL_OVERFLOW = 0
```

Three blurred layers for an entire application — sidebar, composer, and one
surface. UI-2 removed two per tracking surface; the shell does not reintroduce
them.

---

## 3. REGRESSIONS RE-VERIFIED (Parts 9–11)

- **Choice vs approval.** Checked in the **final** code, not an intermediate
  screenshot. `.jasim-action--consequential` (outlined, warning-toned) applies
  when `action.requiresApproval`; a CHOICE never carries it. A lone action does
  not stretch. Asserted by test, and visible in the UI-2 evidence.
- **Internal reference leaks: 0.** `ref-1` is in `data-reference`, never in text.
  Asserted.
- **MAP data shape: PASS.** `data.markers[0].coordinates` → the coordinate
  renders; absent → the honest unavailable state; stale → the stale state. Three
  assertions, and the `E-map-fresh` / `F-map-stale` images.
- **RTL measured with Playwright**, never from raw Chrome's x-origin — the UI-2
  false positive is not repeatable.

---

## 4. OBSERVED AND **NOT** FIXED IN THIS PHASE

Recorded rather than quietly dropped. Item 1 has since been fixed on its own;
the rest still stand:

1. ~~**The user's own message is not rendered on the error path.**~~ **FIXED
   AFTER THIS PHASE.** After a failed turn the conversation showed only the
   system reply — visible in `after/G-after-turn.mobile.png`. Recorded here as
   out of scope because it is `useJasimChat` state handling rather than visual;
   it was then fixed on its own, in the Conversation Failure Integrity hotfix
   (`1af5352`). The cause was case A exactly as suspected — the client appended
   messages only in the success branch. See
   `docs/handoff/JASIM_CONVERSATION_FAILURE_INTEGRITY_REPORT.md`. **The
   `G-after-turn` images in this phase's `after/` therefore no longer show
   current behaviour**; the message now stays on screen above the notice.
2. **A duplicate composer hint** appears near the top of the conversation area
   at tablet width (`after/A-empty.tablet.png`, y≈123).
3. **Scenarios C–F and I–L were not captured in the shell.** CHOICE, MAP,
   APPROVAL, Living Objects, long scroll and the three morph phases inside the
   assembled shell all need seeded canonical conversation rows. Their
   *surfaces* are proven in UI-2; their *composition inside the shell* is not.
   This is the honest reason UI-2.1 is `PARTIAL`.
4. **Google Fonts is blocked by the proxy in this environment**
   (`ERR_CERT_AUTHORITY_INVALID`), so the shell screenshots render Arabic in a
   fallback face. Layout, direction, colour and hierarchy are trustworthy;
   **fine typographic judgement from these images is not.** The UI-2 surface
   captures use a locally served Noto Sans Arabic and are reliable for that.

---

## 5. REGRESSION

| Suite | Result |
|---|---|
| Main suite | **1203 / 1203** (+7 skipped: live-model, visual capture, shell capture) |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** |
| `tsc -b` | **PASS** |
| Web build | **PASS** (5.25s) |

**No inherited test was modified.** Bundle: JS 869,562 B (+1.1 kB over UI-2),
CSS 178,410 B (+38 B). `PERFORMANCE_REGRESSIONS = 0`.

---

## 6. COUNTERS

```
UI_2_1                              = PARTIAL

REAL_AUTHENTICATED_PRODUCT_CAPTURE  = YES
REAL_PRODUCT_COMPONENTS_USED        = YES
PRODUCTION_AUTH_BYPASS_ADDED        = NO
PRODUCTION_DATABASE_TOUCHED         = NO

MOBILE_SCREENSHOTS                  = 3   (1 before, 2 after)
TABLET_SCREENSHOTS                  = 3   (1 before, 2 after)
DESKTOP_SCREENSHOTS                 = 3   (1 before, 2 after)

CONVERSATION_VISUALLY_PRIMARY       = PASS
COMPOSER_UX                         = PASS
ACTIVE_WORKSPACE_VISUAL_WEIGHT      = PARTIAL   (never seen with content — §4.3)
LIVING_OBJECTS_VISUAL_WEIGHT        = PARTIAL   (only the zero-object case seen)
NAVIGATION_UX                       = PASS      (conversations only; no domains)
CHOICE_VS_APPROVAL_DISTINCTION      = PASS
INTERNAL_REFERENCE_LEAKS            = 0
MAP_DATA_SHAPE_REGRESSION           = PASS
UNINTENDED_HORIZONTAL_OVERFLOW      = 0
RTL                                 = PASS
ACCESSIBILITY                       = PARTIAL   (contrast still unmeasured)
PERFORMANCE_REGRESSIONS             = 0

FAKE_PRODUCTION_DATA_ADDED          = 0
DOMAIN_SPECIFIC_UI_COMPONENTS_ADDED = 0
ARCHITECTURE_FREEZE_VIOLATIONS      = 0

MAIN_SUITE                          = 1203 / 1203 (+7 skipped)
BLOCK_2                             = 101 / 101
BLOCK_3                             = 133 / 133
BLOCK_3_1                           = 65 / 65
TYPECHECK                           = PASS
WEB_BUILD                           = PASS

FULL_PRODUCT_UI_VISUALLY_PROVEN     = YES, for the empty and blocked states
                                      NO, for workspace-with-content states

READY_TO_PAUSE_UI_WORK_FOR_REAL_RUNTIME_INTEGRATION = YES
```

**`READY_TO_PAUSE = YES`, and the reason is not that UI work is finished.**
The three scenarios still unseen (§4.3) all require a conversation that produced
a real surface — which requires a real model. Building seed fixtures to fake
that state would be a worse use of the next hour than connecting the provider
that makes it real, and would risk exactly the fabricated-state problem these
phases exist to prevent.

The UI is now good enough to be a truthful window onto whatever the runtime
does next. Stage 1 of the roadmap — the first real model provider — is the thing
that unblocks both the product and the last of this phase's evidence.

END OF UI-2.1 REPORT.
