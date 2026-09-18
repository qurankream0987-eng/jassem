# JASIM — CURRENT APPROVED PRODUCT SCREENS

**Captured:** 2026-09-18 · **Source:** the real product code, running. Not a mockup.

| | Path |
|---|---|
| **Canonical web product** | `canonical/جاسم/app/src` |
| **Canonical mobile product** | `artifacts/jasim-mobile` |
| **Operator console (NOT the user product)** | `artifacts/jasim` |

## How these were produced

The web shell was captured from `npx vite` serving the real app with the real
Hono API mounted, authenticated through the product's own
`/api/runtime/session` endpoint — the same path a person takes. Real components,
real stylesheet, real fonts. No HTML was recreated for the screenshot.

The 13 generated-surface states are rendered from the real
`PresentationRenderer` with the compiled product stylesheet, driven by
**deterministic fixtures** (`tests/ui/ui-scenarios.ts`) built by running the
real `decidePresentation`. **They are fixture states and are labelled as such
in the image header.** No provider-backed real-world data was invented.

## Files

- `A-empty.{mobile,tablet,desktop}.png` — the main screen, authenticated, empty
- `G-after-turn.{mobile,tablet,desktop}.png` — a real turn with no model configured
- `A…M-*.{mobile,tablet,desktop}.png` — 13 surface states × 3 viewports (fixture)
- `NATIVE-mobile.png` — the real Expo app, web export, honest connection-error state
- `MEASURED.txt` — shell measurements
- `OVERFLOW.txt` — overflow measurement across all 39 surface pages

## Measurements, not impressions

```
horizontal overflow    0 / 39 surface pages, 0 / 3 shell viewports
<html dir>             rtl at all three viewports
composer visible       yes at all three
composer placeholder   «اكتب ما تريد أن يحدث…»
blurred layers         2 (mobile) / 3 (tablet, desktop)
```
