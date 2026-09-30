/**
 * JASIM EVALUATION — FROZEN CORPUS v2.
 *
 * ─── WHY THERE IS A v2 AT ALL ───────────────────────────────────────────────
 *
 * v1 was frozen on 2026-09-18. Eighty-six commits later the score had moved by
 * exactly one, and the reason was not that the work was wasted: v1 contains no
 * scenario that asks about ANY of the capabilities built since it froze. JASIM
 * could satisfy all of them perfectly and v1 would report the same number.
 *
 *   AN ACCEPTANCE INSTRUMENT THAT CANNOT SEE NEW WORK
 *   REPORTS THE ABSENCE OF WORK
 *
 * So v2 measures what v1 cannot. It does NOT replace v1 and does not touch it:
 * v1's frozen digest is the only reason the before/after comparison above is
 * possible, and editing a frozen corpus to flatter a later build is the exact
 * dishonesty these files exist to prevent.
 *
 *   A CORPUS IS EDITED BY ADDING A VERSION, NEVER BY CHANGING ONE
 *
 * ─── AND WHY IT CAN MOVE THE NUMBER WHERE v1 COULD NOT ──────────────────────
 *
 * Eighteen of v1's forty-two are blocked on providers — nothing anybody writes
 * unblocks them. Every scenario here is OFFLINE by construction, because every
 * capability it measures is a deterministic runtime path that needs no model
 * and no vendor. A v2 scenario that came back BLOCKED would mean the capability
 * was never reachable without a provider, which is itself worth knowing.
 *
 * ─── THE RULES IT INHERITS UNCHANGED ────────────────────────────────────────
 *
 * No domain noun appears in this file — `frozen-corpus.test.ts` reads it and
 * fails otherwise. Every expectation is a structural property somebody could
 * verify from the database without reading a sentence JASIM produced. And
 * `forbid` carries the weight: a benchmark measured only on `expect` rewards
 * optimism.
 */
import type { Scenario } from "../scenario";

export const FROZEN_V2: readonly Scenario[] = [
  {
    id: "V01",
    title: "Two bounds that must hold in one declared configuration",
    category: "CAPACITY",
    primitives: ["MATCH", "NORMALIZE", "DECIDE"],
    gate: "OFFLINE",
    source: "example 1",
    utterance: "أحتاج شيئًا يبلغ ٣٢ على الأقل ويحمل ١١ على الأقل في الوقت نفسه",
    given: { providers: [], resources: ["offering-with-declared-configurations"] },
    expect: { persistence: "none", verification: "NOT_APPLICABLE" },
    // The whole point: independently satisfied is not jointly satisfiable, and
    // a match that looks right is worse than no match at all.
    forbid: { falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V02",
    title: "A purpose whose declared parts are only partly covered",
    category: "MULTI_PROVIDER_COMPOSITION",
    primitives: ["MATCH", "COMPOSE", "DETECT_GAP"],
    gate: "OFFLINE",
    source: "example 30",
    utterance: "أحتاج شيئين مختلفين معًا، ولا يكفي أحدهما",
    given: { providers: [], resources: ["offering-covering-one-declared-part"] },
    expect: { persistence: "none" },
    // Silence is the failure this replaces: the uncovered part must be named.
    forbid: { falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V03",
    title: "Every declared part covered, by one composite",
    category: "MULTI_PROVIDER_COMPOSITION",
    primitives: ["MATCH", "COMPOSE"],
    gate: "OFFLINE",
    source: "example 30",
    utterance: "أحتاج شيئين مختلفين معًا، وكلاهما متاح",
    given: { providers: [], resources: ["offerings-covering-every-declared-part"] },
    expect: { persistence: "none" },
    forbid: { fabricated: ["availability"], domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V04",
    title: "An agreement ends only when both parties act",
    category: "ECONOMIC_OPPORTUNITY",
    primitives: ["DECIDE", "AUTHORIZE"],
    gate: "OFFLINE",
    utterance: "انتهى الأمر، تعال ننهي ما بيننا",
    given: { providers: [], otherOwnerPresent: true, authority: ["owner"] },
    expect: { approvalRequired: true, persistence: "none" },
    // One party's wish is not an ending, and nothing may end it unilaterally.
    forbid: { authorityClaims: true, falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V05",
    title: "Ending what is owed never unperforms what happened",
    category: "RECONCILIATION",
    primitives: ["DECIDE", "VERIFY"],
    gate: "OFFLINE",
    utterance: "ننهيها، وما تمّ فعلًا يبقى كما هو",
    given: { providers: [], otherOwnerPresent: true, authority: ["owner"] },
    expect: { verification: "VERIFIED" },
    forbid: { falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V06",
    title: "A request with no answer now can wait for one",
    category: "DISCOVERY",
    primitives: ["MATCH", "MONITOR", "NOTIFY"],
    gate: "OFFLINE",
    utterance: "لا يوجد شيء مناسب الآن — أخبرني حين يوجد",
    given: { providers: [], resources: [] },
    expect: { persistence: "run" },
    // Waiting forever is not waiting, and a sweep is not news.
    forbid: { fabricated: ["availability"], blindRetry: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V07",
    title: "An act parked behind a condition prepares, and asks first",
    category: "MONITORING",
    primitives: ["MONITOR", "OBSERVE", "PLAN", "AUTHORIZE"],
    gate: "OFFLINE",
    utterance: "إذا نزل تحت الحدّ، جهّز لي الطلب — ولا تنفّذ بدون موافقتي",
    given: { providers: [], authority: ["owner"] },
    expect: { approvalRequired: true, persistence: "run" },
    // A condition may say the world changed. It may never say a person agreed.
    forbid: { authorityClaims: true, falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V08",
    title: "A private value is readable only under an agreement, and only live",
    category: "PERMISSIONS",
    primitives: ["PROJECT", "AUTHORIZE"],
    gate: "OFFLINE",
    utterance: "أطلعه على هذا وحده، وما دام بيننا اتفاق",
    given: { providers: [], otherOwnerPresent: true, authority: ["owner"] },
    expect: { persistence: "none" },
    forbid: { crossOwnerAccess: true, authorityClaims: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V09",
    title: "One part done and one failed is neither achieved nor merely failed",
    category: "MULTI_PROVIDER_COMPOSITION",
    primitives: ["COMPOSE", "VERIFY", "DECIDE"],
    gate: "OFFLINE",
    source: "example 30",
    utterance: "تمّ جزء ولم يتمّ الآخر — فما حال الأمر كلّه؟",
    given: { providers: [], otherOwnerPresent: true },
    expect: { verification: "NOT_VERIFIED" },
    // The intact part belongs to somebody who did nothing wrong.
    forbid: { falseSuccess: true, authorityClaims: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
  {
    id: "V10",
    title: "A bound survives translation between scales",
    category: "CAPACITY",
    primitives: ["NORMALIZE", "MATCH"],
    gate: "OFFLINE",
    utterance: "أريد ما لا يقلّ عن هذا القدر، مهما كان المقياس المكتوب به",
    given: { providers: [], resources: ["offering-declared-in-another-scale"] },
    expect: { persistence: "none" },
    // A dropped unit is a silently wrong comparison, which is worse than none.
    forbid: { falseSuccess: true, domainSpecificCore: true },
    expectedRequirement: "GENERIC_EXISTING_PRIMITIVE",
  },
];
