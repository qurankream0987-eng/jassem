import { decidePresentation } from "../../api/runtime/presentation-fabric";
import type { PresentationDefinition } from "../../api/runtime/presentation-fabric";

/**
 * JASIM — UI-1 visual acceptance scenarios (Part 25).
 *
 * Every scenario is produced by running the canonical decision layer,
 * `decidePresentation`, over a semantic input. None is a hand-written
 * presentation.
 *
 * That distinction is the whole value of the file. A hand-written fixture
 * proves the renderer can draw a shape somebody typed; running the real
 * decision layer proves the renderer draws what the runtime actually decides —
 * so if a future change to the decision cascade reroutes "ambiguous reference"
 * away from CHOICE, these scenarios change with it instead of quietly
 * continuing to describe a product that no longer exists.
 *
 * NO FAKE PRODUCTION DATA. The payloads here are test fixtures and stay in
 * `tests/`. They never ship: the running UI renders whatever canonical state
 * exists, and renders an honest empty or unavailable surface when none does.
 * The values are deliberately generic — "الخيار الأول", "المرجع الأول" — rather
 * than plausible products, prices or people, so that nothing in this file could
 * be lifted into the product and mistaken for real content.
 */

export type UiScenario = {
  id: string;
  /** The user-visible situation, in the language the product speaks. */
  title: string;
  /** What a reviewer should check in the rendered output. */
  expectation: string;
  presentation: PresentationDefinition;
};

/** Coordinates for the MAP scenario. Null Island — unmistakably a fixture. */
const FIXTURE_COORDINATES = { lat: 0, lng: 0 };

export const UI_SCENARIOS: UiScenario[] = [
  {
    id: "A-plain-conversation",
    title: "محادثة نصية عادية",
    expectation: "Plain text. No card, no chrome — a sentence should look like a sentence.",
    presentation: decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "text",
      data: { text: "نص محادثة عادي بدون أي سطح مولَّد." },
    }),
  },
  {
    id: "B-search-results",
    title: "نتائج بحث",
    expectation: "A result set. Ordinals must be visible so 'الثاني' can refer to something.",
    presentation: decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "candidates",
      data: {},
      candidates: [
        { title: "الخيار الأول", referenceKey: "ref-1" },
        { title: "الخيار الثاني", referenceKey: "ref-2" },
        { title: "الخيار الثالث", referenceKey: "ref-3" },
        { title: "الخيار الرابع", referenceKey: "ref-4" },
      ],
    }),
  },
  {
    id: "C-comparison",
    title: "قارن الثاني والرابع",
    expectation: "A comparison surface over an EXISTING result set — no fresh search.",
    presentation: decidePresentation({
      interactionNeed: "compare",
      data: {
        items: [
          { title: "الخيار الثاني", referenceKey: "ref-2" },
          { title: "الخيار الرابع", referenceKey: "ref-4" },
        ],
      },
    }),
  },
  {
    id: "D-ambiguous-choice",
    title: "مرجع غامض → CHOICE",
    expectation:
      "CHOICE, with a select action. Options carry reference keys only — never coordinates.",
    presentation: decidePresentation({
      interactionNeed: "collect_input",
      data: {},
      candidates: [
        { title: "المرجع الأول", referenceKey: "ref-1" },
        { title: "المرجع الثاني", referenceKey: "ref-2" },
      ],
    }),
  },
  {
    id: "E-map-fresh",
    title: "خريطة بمشاهدة حديثة",
    expectation: "MAP with a position. Freshness must be stated, not implied.",
    presentation: decidePresentation({
      interactionNeed: "track",
      data: { subject: "الموضوع المتتبَّع" },
      observation: {
        status: "FRESH",
        coordinates: FIXTURE_COORDINATES,
        observedAt: "2026-01-01T00:00:00.000Z",
        source: "fixture",
      },
    }),
  },
  {
    id: "F-map-stale",
    title: "خريطة بدون مشاهدة حديثة",
    expectation:
      "NO position may be drawn. A stale observation must read as stale, never as a location.",
    presentation: decidePresentation({
      interactionNeed: "track",
      data: { subject: "الموضوع المتتبَّع" },
      observation: {
        status: "STALE",
        observedAt: "2020-01-01T00:00:00.000Z",
        source: "fixture",
      },
    }),
  },
  {
    id: "G-approval-required",
    title: "إجراء يحتاج موافقة",
    expectation: "APPROVAL. Consequences listed before the button, not after.",
    presentation: decidePresentation({
      interactionNeed: "authorize",
      data: {},
      approvalSummary: {
        action: "إجراء ذو أثر خارجي",
        stateChanges: ["تغيير أول في الحالة", "تغيير ثانٍ في الحالة"],
        publicData: ["بيان يُشارك مع طرف خارجي"],
      },
    }),
  },
  {
    id: "H-living-object",
    title: "كائن حي / مراقبة مستمرة",
    expectation: "A persistent object. Secondary to the conversation, never a second dashboard.",
    presentation: decidePresentation({
      interactionNeed: "operate_persistent",
      persistent: true,
      data: { title: "مراقبة مستمرة", attribute: "سمة مُراقَبة" },
    }),
  },
  {
    id: "I-operation-running",
    title: "عملية قيد التنفيذ",
    expectation:
      "Indeterminate. No percentage may appear unless the runtime reports real progress.",
    presentation: decidePresentation({
      interactionNeed: "show_state",
      transactionState: "ongoing",
      data: { state: "قيد التنفيذ" },
    }),
  },
  {
    id: "J-operation-completed",
    title: "عملية مكتملة",
    expectation: "A settled result. Completion is a canonical fact, not an animation.",
    presentation: decidePresentation({
      interactionNeed: "show_result",
      semanticOutput: "structured",
      data: { state: "مكتملة", summary: "ملخص النتيجة" },
    }),
  },
  {
    id: "K-provider-unavailable",
    title: "المزود غير متاح",
    expectation:
      "A blocked state, visibly NOT a success. Must not be rendered in a success colour.",
    presentation: decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "error",
      data: {
        reason: "BLOCKED_BY_PROVIDER",
        message: "المزود المطلوب غير متاح الآن.",
      },
    }),
  },
  {
    id: "L-model-unavailable",
    title: "نموذج الذكاء غير متاح",
    expectation: "Same: blocked, honest, and distinguishable from an empty result.",
    presentation: decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "error",
      data: {
        reason: "MODEL_GATEWAY_UNAVAILABLE",
        message: "تعذّر الوصول إلى نموذج الذكاء.",
      },
    }),
  },
  {
    id: "M-empty-state",
    title: "لا توجد نتائج",
    expectation: "An empty result is not an error and must not be dressed as one.",
    presentation: decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "empty",
      data: { message: "لا توجد نتائج مطابقة." },
    }),
  },
];
