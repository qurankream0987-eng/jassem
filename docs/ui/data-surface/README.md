# JASIM — the data surface, inside the active conversation

**Captured:** 2026-09-20 · **Source:** the real product, running. Not a mockup and not a
component in isolation.

Every screenshot below is the product's own chat page, authenticated through the
product's own `/api/runtime/session` endpoint, showing messages that the shipped runtime
wrote to the real database. The rows are rows the capture inserted into `runs` and read
back through the shipped source adapter — they are not fixtures drawn to look like data.

**What is not real:** the model's envelope. No provider credentials exist in this
environment (`REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`), so the one thing that could not
be real is the JSON a model would have returned. Everything downstream of it — route,
goal, plan, DataNeed, authorization, query, dataset, surface, message, rendering — is the
shipped code. This is stated rather than hidden.

Reproduce:

```
# the runtime
DATABASE_URL=… SESSION_SECRET=… npx vite --port 5731 --host 127.0.0.1

# the web captures (A–G)
JASIM_SHELL_URL=http://127.0.0.1:5731 JASIM_SHELL_OUT=<dir> \
  npx vitest run tests/ui/capture-data-surface.test.ts

# the native captures (M-A, M-B) — the real React Native components, via Expo Web
EXPO_PUBLIC_DOMAIN=http://127.0.0.1:5731 npx expo export --platform web --dev \
  --output-dir <dir> && npx serve -l 5742 -s <dir>
OUT=<dir> node tests/ui/capture-native-surface.mjs
```

---

## Web — the six states, plus the way back

| | what the person said | what JASIM drew |
|---|---|---|
| **A** `A-table.desktop.png` | «أرني عملياتي» | A TABLE of five real rows, «5 صفاً · حسب آخر قراءة» |
| **B** `B-table-sorted.desktop.png` | «رتبها من الأعلى» | The SAME dataset, re-sorted. «الهدف ↓» says which column the order is by |
| **C** `C-chart-after-morph.desktop.png` | «حولها إلى رسم» | A CHART of the same dataset — MORPH, no second read |
| **G** `G-table-after-chart.desktop.png` | «رجّعها جدول» | The TABLE again, still sorted DESC. The morph goes both ways |
| **D** `D-empty.desktop.png` | a filter matching nothing | «لا توجد نتائج مطابقة. لم أعرض أي بيانات غير حقيقية.» |
| **E** `E-unavailable.desktop.png` | «أرني مبيعاتي» | UNAVAILABLE — a notice naming what DOES exist. No invented sales |
| **F** `F-denied.desktop.png` | «أرني مفاتيح عملياتي» | DENIED — and none of the denied values on the page |

`C-chart-after-morph.web-390.png` is the same conversation at phone width.

## Native mobile — the same contract, adapted

| | |
|---|---|
| **M-A** `M-A-table.native-390.png` | The TABLE, with a long Arabic value truncated rather than wrapping the row |
| **M-B** `M-B-chart.native-390.png` | The CHART, bars and numbers, at 390px |

Both are the real `components/DatasetSurface.tsx` and `components/MobileTurnSurface.tsx`
running under React Native Web, talking to the same runtime over the same endpoint.

A dev-only LogBox toast (`findNodeHandle is not supported on web`) sits at the bottom of
the native captures. It is react-native-web's own warning in a development bundle, not
the product, and it does not appear in the production export.

---

## What the captures changed

Three defects were only visible once the surfaces were photographed in the real
conversation rather than in isolation. All three are fixed in this commit:

1. **A read asked to be approved.** The Presentation IR came from the envelope's KIND,
   and `direct_action` maps to «موافقة مطلوبة» — so a table arrived with an approval card
   underneath it, asking a person to authorize a read that had already happened. The
   route is the fact; the kind was a guess.

2. **A column the person never asked for pushed out one they did.** The identity field
   travels with every read so a row can be pointed at later. It was also rendered as a
   column, so «أرني الهدف والحالة» returned a wall of UUIDs with «الحالة» clipped off the
   edge. The field still travels; it is no longer a column of an answer nobody asked it to
   be part of.

3. **The bar chart had no bars at 390px.** Fixed label and value widths left the track
   nothing, so the phone drew a list of category names. A chart with no bars and a chart
   with bars look nearly identical in a thumbnail, which is why the capture now measures
   the track width instead of trusting the picture.

`CAPTURED.txt` holds the measurements taken beside each screenshot — the primitives and
lifecycles present in the DOM, the routed states, horizontal overflow, and the bar-track
widths.
