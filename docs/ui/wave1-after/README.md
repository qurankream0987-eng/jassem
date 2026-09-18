# JASIM — PRODUCT COMPLETION WAVE 1 · AFTER

**Captured:** 2026-09-18 · **Source:** the real product code, running. Not a mockup.
**Before:** `docs/ui/current-approved/` — the accepted JASIM 1.0 visual baseline.

The web shell was captured from `npx vite` serving the real app with the real Hono API
mounted, authenticated through the product's own `/api/runtime/session` endpoint — the
same path a person takes. Real components, real stylesheet, real fonts. No HTML was
recreated for a screenshot. The product was not redesigned.

---

## Before → after, measured

### Desktop — the empty state was an island in an empty column

| | before | after |
|---|---|---|
| island width | 407px | **672px** |
| island as % of the conversation column | 35.4% | **58.3%** |
| island height | 264px | **336px** |
| empty above / below | 251 / 264 | **269 / 173** |
| total empty vertical space | 515 of 765 (67%) | **442 of 765 (58%)** |

The gap that mattered was the one *below*: 264px of nothing between the last suggestion
and the composer, sitting exactly in the path from "here is what I can do" to the one
control that does it. It is now 173px, and the suggestion grid is no longer 407px wide
above a 976px composer.

### Tablet — the sidebar was sized for a desktop

| | before | after |
|---|---|---|
| sidebar width | 288px | **240px** |
| sidebar as % of an 834px viewport | 34.5% | **28.8%** |
| conversation column | 546px | **594px** |
| empty-state island as % of that column | 74.6% | **86.2%** |

288px is correct at 1440 (20%) and wrong at 834. Titles truncate already, so the
narrower band below `lg` costs a few characters and returns 48px to the conversation.
Desktop sidebar width is unchanged.

### Phone — deliberately untouched

| | before | after |
|---|---|---|
| island as % of column | 91.8% | **91.8%** |
| empty above / below | 162 / 175 | **162 / 175** |

The phone measured fine and every new class is behind `sm:` or `lg:`. The one phone
change is the composer hint (below).

---

## What the capture shows that a measurement cannot

**`G-after-turn.mobile.png` / `MEASURED.txt`:**

- **«أنت», not «You».** The before capture reads `محادثة جديدة | مسح | You | 02:58 م`.
  The after capture reads `اعرض لي السائق | مسح | أنت | 03:42 م`.
- **Conversations have names.** The before sidebar was fourteen identical rows reading
  «محادثة جديدة». The after sidebar reads «اعرض لي السائق» for every conversation that
  has had a turn. Rows still reading «محادثة جديدة» are older conversations that never
  received a first message — the title is derived from what the person actually wrote,
  and an empty conversation has nothing to derive from.
- **«جاسم», not «جاسيم».** Visible in `A-empty.desktop.png`.
- **The keyboard hint is gone on a touch device.** Before, the phone's composer text
  ended `… | Shift + Enter لسطر جديد | Enter للإرسال`. After, it ends
  `… | ماذا تستطيع أن تفعل؟`. The composer's bottom edge moved from 801 to **824** in an
  844px viewport — 20px of reclaimed space, and one fewer instruction nobody holding a
  phone can follow.
- **No horizontal overflow** at any of the three viewports, before or after.

---

## The mobile endpoint rule, proven in a production export

`NATIVE-mobile-production-refuses-http.png` is a **real Expo production web export**
(`__DEV__ === false`, verified in the running page) configured with
`EXPO_PUBLIC_DOMAIN=http://127.0.0.1:5731`.

```text
DEV flag                  false
API requests attempted    []            ← none. The plaintext request never left.
On screen                 تعذر الاتصال
                          لم تُضبط وجهة الخادم لهذا التطبيق. تواصل مع المسؤول.
```

The production build refused the plaintext endpoint before a single byte was sent, and
said so in a message that names no environment variable, host or scheme. The
technical cause stays on the error's `.message` for a developer.

Two further facts from the bundle itself:

- The string `"A production build refuses a plaintext runtime endpoint"` **is** in the
  shipped bundle.
- The string `"A development build may use http only for a local runtime address"` **is
  not** — `__DEV__` is statically false, so the minifier removed the development branch
  entirely. A production build cannot take the HTTP path, it does not merely decline to.

`NATIVE-mobile.png` is the same export configured with `127.0.0.1:5731` (no scheme).
The resolver assumed HTTPS — the safe reading of an ambiguous configuration — the dev
server speaks HTTP, and the honest result is a connection error rather than a silent
downgrade. That is the rule working, not a defect in the capture.

---

## Files

| File | What it is |
|---|---|
| `A-empty.{mobile,tablet,desktop}.png` | the main screen, authenticated, empty |
| `G-after-turn.{mobile,tablet,desktop}.png` | a real turn with no model provider configured |
| `NATIVE-mobile.png` | the real Expo production export, HTTPS assumed, honest connection error |
| `NATIVE-mobile-production-refuses-http.png` | the same export refusing a plaintext endpoint |
| `MEASURED.txt` | shell measurements and on-screen text, before/after comparable |
| `SPACING.txt` | the spacing measurements this README tabulates |
