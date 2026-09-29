import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  commercialOrders,
  economicExpressions,
  plans,
  referenceBindings,
} from "@db/schema";
import {
  createEngagement,
  createExpression,
  matchNeedToOffering,
  participantsForMatch,
  publishExpression,
  stateOwnAttribute,
} from "../economic-fabric";
import { proposeTermSheet } from "../agreement-runtime";
import {
  ConfigurationError,
  configurableTermsOf,
  configurationFingerprint,
  mergedProposalTerms,
  validateConfiguration,
} from "./party-configuration";
import { createCommercialOrder, termsFingerprint, updateCommercialTerms } from "../block3/commercial-orders";
import { createPaymentIntent } from "../block3/payment-intents";
import { paymentExecutionRoute } from "../payment-route";
import { applyApprovedCommercialChange } from "../block3/commercial-changesets";
import { createWorldPlan } from "../block3/generated-business-economics";
import type { GeneratedWorldService } from "../../core/generated-world-service";
import { discover } from "./discovery";
import { bindReference, resolveOrdinal, resolveThis } from "./reference-bindings";
import {
  composeOffering,
  publishComposedOffering,
  readDraft,
} from "../seller-composition";
import { resolvePayable } from "./canonical-payable";
import { askCounterparty, currentAnswersFor } from "../cross-party-brokering";
import {
  DISCLOSABLE_SUBJECT_KIND,
  DisclosureError,
  discloseToCounterparty,
} from "../private-disclosure";
import { commitAgreement } from "../agreement-runtime";
import { economicProposals, economicEngagements } from "@db/schema";
import { agreements } from "@db/schema-block2";

type IntentEnvelope = {
  decisionId: string;
  kind: string;
  goal?: string;
  intent?: {
    requiredCapabilities: string[];
    missingInputs: string[];
    inputs: Record<string, unknown>;
  };
};

export type ConversationCommerceResult = {
  kind: "structured_result";
  label: string;
  summary: string;
  data: Record<string, unknown>;
  status?: "completed" | "awaiting_input" | "awaiting_approval" | "reapproval_required" | "blocked";
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

function labels(envelope: IntentEnvelope): string {
  return (envelope.intent?.requiredCapabilities ?? []).join(" ").toLowerCase();
}

function hasLabel(envelope: IntentEnvelope, pattern: RegExp): boolean {
  return pattern.test(labels(envelope));
}

function ordinals(text: string): number[] {
  const normalized = text.toLowerCase();
  const words: Array<[RegExp, number]> = [
    [/\b(?:first|1st)\b|الأول|الاول/u, 1],
    [/\b(?:second|2nd)\b|الثاني(?:ة)?/u, 2],
    [/\b(?:third|3rd)\b|الثالث(?:ة)?/u, 3],
    [/\b(?:fourth|4th)\b|الرابع(?:ة)?/u, 4],
    [/\b(?:fifth|5th)\b|الخامس(?:ة)?/u, 5],
  ];
  const resolved = words
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, value]) => value);
  for (const match of normalized.matchAll(/(?:ordinal|position)\s*[:=]?\s*(\d+)/gu)) {
    resolved.push(Number(match[1]));
  }
  return [...new Set(resolved)].filter((value) => Number.isInteger(value) && value > 0);
}

function ordinal(text: string): number | null {
  return ordinals(text)[0] ?? null;
}

function explicitlyRequestsUnavailableExternalSource(scope: unknown, selectedSources: readonly string[]): boolean {
  const requested = (Array.isArray(scope) ? scope : [scope])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toUpperCase());
  const externalAliases = new Set([
    "WEB",
    "INTERNET",
    "WEB_OBSERVATION",
    "CONNECTED",
    "CONNECTED_PROVIDER",
    "MCP",
    "MCP_PROVIDER",
    "A2A",
    "A2A_PROVIDER",
  ]);
  return requested.some((value) => externalAliases.has(value)) && selectedSources.length === 0;
}

function moneyFrom(input: Record<string, unknown>): { amountMinor: string; currency: string } | null {
  const money = object(input.money);
  const amount = input.priceMinor ?? input.amountMinor ?? money.amountMinor ?? money.minor;
  const currency = input.currency ?? money.currency;
  if (
    (typeof amount !== "string" && typeof amount !== "number") ||
    typeof currency !== "string" ||
    !/^[0-9]+$/.test(String(amount))
  ) return null;
  return { amountMinor: String(amount), currency: currency.trim().toUpperCase() };
}

function publicTerms(expression: typeof economicExpressions.$inferSelect): Record<string, unknown> {
  const projection = object(expression.publicProjection);
  return object(projection.publicTerms);
}

async function activeBinding(db: NodePgDatabase<any>, ownerId: string, conversationId: string, key: string) {
  const [binding] = await db
    .select()
    .from(referenceBindings)
    .where(and(
      eq(referenceBindings.conversationId, conversationId),
      eq(referenceBindings.ownerId, ownerId),
      eq(referenceBindings.referenceKey, key),
      isNull(referenceBindings.supersededAt),
    ))
    .orderBy(desc(referenceBindings.createdAt))
    .limit(1);
  return binding;
}

async function currentOffering(db: NodePgDatabase<any>, id: string, requesterOwnerId: string) {
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, id))
    .limit(1);
  if (!row || row.kind !== "offering" || row.status !== "active") return null;
  if (row.ownerId !== requesterOwnerId && row.visibility !== "public") return null;
  return row;
}

function safeCandidate(candidate: Awaited<ReturnType<typeof discover>>["candidates"][number]) {
  return {
    id: candidate.id,
    position: candidate.position,
    title: candidate.title,
    summary: candidate.summary,
    source: candidate.source,
    canonicalRef: candidate.canonicalRef,
    externalRef: candidate.externalRef,
    trust: candidate.trust,
    provenance: candidate.provenance,
    observedMoney: candidate.observedPriceMinor === null
      ? null
      : { amountMinor: String(candidate.observedPriceMinor), currency: candidate.observedCurrency },
    availability: candidate.availability,
    actionable: candidate.actionable,
  };
}

/**
 * WHERE THE PERSON SAID THEY ARE.
 *
 * Read from their own subject, never from the envelope. The origin decides
 * which candidates are near enough to be found at all, so a model that could
 * name it could quietly search from somewhere else entirely.
 *
 *   MODEL_NAMES_THE_SEARCH_ORIGIN = 0
 *
 * A point they have not confirmed is carried with `inferred`, and the fabric
 * then refuses to let the derived distance decide anything — «not known to be
 * near» stays different from «near».
 *
 *   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
 */
async function searchOrigin(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string },
): Promise<{ lat: number; lng: number; inferred?: boolean } | undefined> {
  const bound = await activeBinding(db, input.ownerId, input.conversationId, "current:need");
  if (!bound) return undefined;
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, bound.targetId))
    .limit(1);
  if (!row || row.ownerId !== input.ownerId) return undefined;
  const point = object((row.attributes as Record<string, unknown>).location);
  const lat = point.lat;
  const lng = point.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  const provenance = (row.attributeProvenance ?? {}) as Record<string, string>;
  return {
    lat,
    lng,
    ...(provenance.location === "STATED" ? {} : { inferred: true }),
  };
}

async function discoverTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  const query = string(values, "query", "subject", "semanticType") ?? input.envelope.goal ?? input.content;

  // WHY the search is happening comes from CANONICAL NEED STATE, not from the
  // transcript and not from the model restating constraints it was told three
  // turns ago. What the model supplies on this turn still wins where it says
  // something — but silence now means «use what JASIM already holds» rather
  // than «there are no constraints».
  //
  //   DISCOVERY_USES_CANONICAL_NEED = PASS
  //   DISCOVERY_RECONSTRUCTS_NEED_FROM_CHAT_HISTORY = NO
  const stated = Array.isArray(values.hardConstraints)
    ? (values.hardConstraints as never[])
    : [];
  const { currentNeed, hardConstraintsForDiscovery } = await import("../need-continuity");
  // The need's own bounds, NORMALIZED into discovery's terms. «أقل من ٣ دنانير»
  // becomes «priceMinor <= 3000, currency KWD» — derived for this search, while
  // the need goes on saying what the person said.
  const translation = await hardConstraintsForDiscovery({
    conversationId: input.conversationId,
    scopeId: input.ownerId,
  });
  const carried = stated.length > 0 ? stated : (translation.applied as never[]);
  // ── WHERE THE SEARCH IS FROM ────────────────────────────────────────────
  //
  // Read from what the person stated about THEMSELVES, never from the
  // envelope: a model that could name the origin could search from anywhere,
  // and a point is the one input whose owner matters most.
  //
  //   MODEL_NAMES_THE_SEARCH_ORIGIN = 0
  const origin = await searchOrigin(db, input);
  // What the person stated that this search could NOT honestly act on. Carried
  // into the answer so that «not applied» is something they can read.
  //
  //   SILENT_GUESSED_FILTER = 0
  const unapplied = stated.length > 0 ? [] : translation.unapplied;

  // The need AT THE REVISION IT HAS NOW. A later refinement must not be able to
  // claim evidence gathered for what it used to say.
  const need = await currentNeed({
    conversationId: input.conversationId,
    scopeId: input.ownerId,
  });

  const found = await discover(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    query,
    kind: string(values, "kind") === "need" ? "need" : "offering",
    explicitScope: values.scope,
    availability: { internal: true, web: Array.isArray(values.webResults) },
    hardConstraints: carried,
    ...(origin ? { origin } : {}),
    ...(need ? { need: { id: need.id, revision: need.revision } } : {}),
    webResults: Array.isArray(values.webResults) ? values.webResults as never[] : [],
    limit: typeof values.limit === "number" ? values.limit : 20,
  });
  if (explicitlyRequestsUnavailableExternalSource(values.scope, found.resultSet.sources)) {
    return {
      kind: "structured_result",
      label: "Discovery provider unavailable",
      summary: "تعذر تنفيذ البحث الخارجي لأن مزود Discovery المطلوب غير مهيأ.",
      data: {
        resultSetId: found.resultSet.id,
        sources: found.resultSet.sources,
        candidates: [],
        semanticOutput: "error",
        blocker: "BLOCKED_BY_PROVIDER",
        effects: "none",
      },
      status: "blocked",
    };
  }
  await Promise.all(found.candidates.map((candidate) => bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: `ordinal:${candidate.position}`,
    targetKind: "discovery_candidate",
    targetId: candidate.id,
    resultSetId: found.resultSet.id,
    position: candidate.position,
  })));
  if (found.candidates.length === 1) {
    const candidate = found.candidates[0]!;
    await bindReference(db, {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      referenceKey: "deictic:this",
      targetKind: "discovery_candidate",
      targetId: candidate.id,
      resultSetId: found.resultSet.id,
      position: candidate.position,
    });
  }
  return {
    kind: "structured_result",
    label: "Discovery results",
    summary: `${
      found.candidates.length
        ? `وجد جاسم ${found.candidates.length} نتيجة. الأسعار الخارجية ملاحظات غير موثوقة وليست شروط دفع.`
        : "لم يجد جاسم نتائج مطابقة ضمن المصادر المتاحة."
    }${
      unapplied.length > 0
        ? ` لم أستطع تطبيق ${unapplied.length} من شروطك في هذا البحث، فلم أستبعد بها شيئاً.`
        : ""
    }`,
    data: {
      resultSetId: found.resultSet.id,
      sources: found.resultSet.sources,
      candidates: found.candidates.map(safeCandidate),
      // WHAT WAS ACTUALLY FILTERED ON, derived from the need, and what was
      // not. Both are part of the answer: a bound that could not be honoured
      // is a fact about this search, not a silence.
      appliedConstraints: found.resultSet.hardConstraints,
      unappliedConstraints: unapplied,
    },
    status: "completed",
  };
}

async function compareTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  const requestedPositions = Array.isArray(values.positions)
    ? values.positions.filter((value): value is number => typeof value === "number")
    : ordinals(input.content);
  const positions = [...new Set(requestedPositions)]
    .filter((value) => Number.isInteger(value) && value > 0);
  if (positions.length < 2) {
    return clarification("حدد نتيجتين على الأقل للمقارنة.");
  }
  const resolutions = await Promise.all(
    positions.map((position) =>
      resolveOrdinal(db, { ownerId: input.ownerId, conversationId: input.conversationId }, position),
    ),
  );
  if (resolutions.some((resolution) => resolution.status !== "RESOLVED")) {
    return clarification("تعذر ربط كل عناصر المقارنة بمجموعة نتائج واحدة مؤكدة.");
  }
  const candidates = resolutions.map((resolution) => {
    if (resolution.status !== "RESOLVED") throw new Error("Unreachable comparison resolution.");
    return resolution.value;
  });
  const resultSetIds = [...new Set(candidates.map((candidate) => candidate.resultSetId))];
  if (resultSetIds.length !== 1) {
    return clarification("عناصر المقارنة لا تنتمي إلى مجموعة النتائج نفسها.");
  }
  return {
    kind: "structured_result",
    label: "Comparison",
    summary: `يقارن جاسم ${candidates.length} نتائج من مجموعة النتائج المحفوظة نفسها.`,
    data: {
      resultSetId: resultSetIds[0],
      selectedPositions: positions,
      candidates: candidates.map(safeCandidate),
      semanticOutput: "comparison",
    },
    status: "completed",
  };
}

/** Where a composed offering waits between the turn that wrote it and the one
 * that confirms it. One key, so a second composition supersedes the first. */
const PENDING_OFFERING_REFERENCE = "pending_offering";

/**
 * COMPOSE WHAT WILL BE SAID, AND SHOW IT BEFORE SAYING IT.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * This turn used to take `envelope.intent.inputs` — a MODEL'S READING of a
 * sentence — and write it straight into a PUBLIC offering attributed to the
 * seller, in one step. The seller's «انشر عرضي» published whatever the model
 * decided the offering says, and a public listing BINDS ITS OWNER.
 *
 *   MODEL_EXTRACTION != SELLER_DECLARATION
 *
 * The composition runtime already knew how to hold a draft and take a
 * confirmation over an exact fingerprint. It simply was not reachable by
 * talking, which is the only way anybody reaches anything here.
 *
 * ─── AND WHY THE PARSE IS NOT MARKED AS A GUESS ─────────────────────────────
 *
 * Nothing here labels the extracted values INFERRED, and that is deliberate.
 * This runtime cannot tell a number the seller typed from one the model assumed
 * — both arrive through the same field — so labelling either way would be a
 * guess about a guess.
 *
 * What it can do is show the seller the EXACT words that would become public
 * and take their confirmation over that exact statement.
 *
 *   CONFIRMATION IS WHAT TURNS A PARSE INTO A DECLARATION.
 *
 * A channel that genuinely knows a value was derived — a photo reader, a video
 * reader — says so through `composeOffering`'s own provenance input, and that
 * value then decides no hard constraint.
 */
async function publishTurn(
  db: NodePgDatabase<any>,
  worlds: GeneratedWorldService,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  const subject = string(values, "subject", "semanticType", "title");
  const money = moneyFrom(values);
  const missing = [...(!subject ? ["subject"] : []), ...(!money ? ["priceMinor", "currency"] : [])];
  if (missing.length) {
    return {
      kind: "structured_result",
      label: "Publication needs input",
      summary: "أحتاج موضوعاً واحداً واضحاً وسعراً بوحدات العملة الصغرى مع رمز العملة قبل النشر.",
      data: { missingInputs: missing, effects: "none" },
      status: "awaiting_input",
    };
  }
  const worldRef = string(values, "worldRef", "worldId");
  if (worldRef) {
    const ownerNumericId = Number(input.ownerId);
    if (!Number.isSafeInteger(ownerNumericId) || !(await worlds.get(ownerNumericId, worldRef))) {
      return clarification("لا يمكن نشر عرض مرتبط بعالم غير موجود أو غير مملوك لك.");
    }
  }
  const publicTerms = {
    money: { amountMinor: money!.amountMinor, currency: money!.currency },
    ...(worldRef ? { worldRef } : {}),
  };
  const willPublish = {
    semanticType: subject!,
    summary: string(values, "summary") ?? subject!,
    publicTerms,
    availability: values.availability ?? "available",
  };
  const draft = await composeOffering({
    ownerId: input.ownerId,
    semanticType: subject!,
    stated: {
      priceMinor: money!.amountMinor,
      currency: money!.currency,
      ...(worldRef ? { worldRef } : {}),
    },
    willPublish,
  });
  // Bound so the next turn knows which statement «أوافق» is about. One key, so
  // composing again supersedes rather than leaving two drafts both confirmable.
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: PENDING_OFFERING_REFERENCE,
    targetKind: "offering_draft",
    targetId: draft.expressionId,
  });
  return {
    kind: "structured_result",
    label: "Offering ready to publish",
    summary: "هذا ما سيُنشر باسمك. راجعه، وقل «أوافق» لينشر.",
    data: {
      expressionId: draft.expressionId,
      // The exact words, so a confirmation is a confirmation OF something.
      willPublish: draft.willPublish,
      stated: draft.stated,
      fingerprint: draft.fingerprint,
      published: false,
      effects: "none",
    },
    status: "awaiting_approval",
  };
}

/**
 * PUBLISH THE STATEMENT THAT WAS SHOWN, AND ONLY THAT.
 *
 * Returns null when there is nothing waiting, so the dispatcher falls through
 * to whatever else a confirmation might mean. A person saying «أوافق» with no
 * draft pending has not published anything by accident.
 *
 *   STALE_CONFIRMATION_PUBLISHES = 0
 */
async function confirmPublishTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult | null> {
  const pending = await resolveThis(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
  });
  if (pending.status !== "RESOLVED" || pending.value.targetKind !== "offering_draft") {
    return null;
  }
  const expressionId = pending.value.targetId;
  let draft;
  try {
    draft = await readDraft({ expressionId, ownerId: input.ownerId });
  } catch {
    // Already published, or no longer this person's to publish. Neither is an
    // error worth a stack trace in a conversation.
    return null;
  }
  const published = await publishComposedOffering({
    expressionId,
    ownerId: input.ownerId,
    // The fingerprint of the statement AS IT IS NOW. If anything moved since it
    // was shown, the composition runtime refuses — and it is read here rather
    // than remembered, so this turn cannot confirm a stale one on its own.
    confirmFingerprint: draft.fingerprint,
  });
  return {
    kind: "structured_result",
    label: "Offering published",
    summary: "نُشر العرض كما عُرض عليك.",
    data: {
      expressionId: published.expressionId,
      version: published.version,
      willPublish: draft.willPublish,
      published: true,
    },
    status: "completed",
  };
}

async function selectTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  const position = typeof values.position === "number" ? values.position : ordinal(input.content);
  if (!position) return clarification("حدد رقم النتيجة التي تريد اختيارها.");
  const resolution = await resolveOrdinal(
    db,
    { ownerId: input.ownerId, conversationId: input.conversationId },
    position,
  );
  if (resolution.status !== "RESOLVED") {
    return clarification(resolution.status === "AMBIGUOUS"
      ? "هناك أكثر من مجموعة نتائج حديثة؛ حدد النتيجة مع وصفها."
      : "لم أجد نتيجة بهذا الرقم في سياق المحادثة.");
  }
  if (!resolution.value.canonicalRef || resolution.value.trust !== "canonical_internal") {
    return clarification("هذه النتيجة دليل خارجي غير موثوق ولا يمكن تحويلها تلقائياً إلى إجراء تجاري.");
  }
  const offering = await currentOffering(db, resolution.value.canonicalRef, input.ownerId);
  if (!offering) return clarification("العرض الأساسي لم يعد متاحاً أو مرئياً.");
  const terms = {
    offeringRef: offering.id,
    offeringVersion: offering.version,
    ...publicTerms(offering),
  };
  const order = await createCommercialOrder(db, {
    ownerId: input.ownerId,
    sellerRef: offering.id,
    buyerRef: input.ownerId,
    terms,
  });
  // The SOURCE offering's published terms, pinned as they were at selection.
  // A later change to them is the counterparty moving, and it must not be
  // confusable with this party configuring their own draft.
  await db
    .update(commercialOrders)
    .set({
      offeringFingerprint: termsFingerprint(publicTerms(offering)),
      // WHICH presented set this came out of, and which item it was. A
      // selection that lost this would lose WHY the candidate was on screen.
      resultSetId: resolution.value.resultSetId,
      candidateId: resolution.value.id,
    })
    .where(eq(commercialOrders.id, order.id));
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:order",
    targetKind: "commercial_order",
    targetId: order.id,
  });
  return {
    kind: "structured_result",
    label: "Draft order",
    summary: "أُنشئ طلب مسودة بالشروط الحالية. راجع الشروط ووافق عليها صراحةً قبل إنشاء نية دفع.",
    data: { orderId: order.id, status: order.status, terms: order.terms, termsVersion: order.termsVersion, termsFingerprint: order.termsFingerprint },
    status: "awaiting_approval",
  };
}

/**
 * «بدون كذا وزيادة كذا» — a party states values for terms the offering left
 * open, and for nothing else.
 *
 *   PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS
 *   CONFIGURATION       != NEGOTIATION
 *
 * The published offering is READ and never written: configuring is something a
 * party does to their own draft. What they state is kept in its own column
 * under its own fingerprint, so this movement and the counterparty changing
 * the offer can never be mistaken for one another.
 */
async function configureTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:order");
  if (!binding || binding.targetKind !== "commercial_order") {
    return clarification("لم تختر شيئاً بعد لأضبط شروطه.");
  }
  const [order] = await db.select().from(commercialOrders).where(and(
    eq(commercialOrders.id, binding.targetId),
    eq(commercialOrders.ownerId, input.ownerId),
  )).limit(1);
  if (!order) return clarification("لم أجد الطلب الحالي ضمن حسابك.");
  if (order.proposalId) {
    // Once it has been sent, changing it is a new proposal, not an edit of one
    // the other party may already be reading.
    return clarification("أرسلتُ هذا الطلب بالفعل. لتغيير الشروط، اختر من جديد.");
  }
  const offeringId = string(object(order.terms), "offeringRef");
  const offering = offeringId ? await currentOffering(db, offeringId, input.ownerId) : null;
  if (!offering) return clarification("لا يمكن إعادة قراءة العرض الأساسي الحالي.");

  const stated = object(input.envelope.intent?.inputs?.configuration);
  if (Object.keys(stated).length === 0) {
    return clarification("لم يتضح ما الذي تريد ضبطه.");
  }

  try {
    const declared = configurableTermsOf(offering.publicProjection);
    if (declared.length === 0) {
      return clarification("هذا العرض بشروط ثابتة؛ لا يترك شيئاً لتضبطه.");
    }
    const accepted = validateConfiguration(stated, declared);
    const fingerprint = configurationFingerprint(accepted);
    const [updated] = await db
      .update(commercialOrders)
      .set({ partyConfiguration: accepted, configurationFingerprint: fingerprint })
      .where(eq(commercialOrders.id, order.id))
      .returning();
    return {
      kind: "structured_result",
      label: "Party configuration",
      summary:
        "سجّلتُ ما طلبته ضمن ما يسمح به العرض. لم أغيّر العرض نفسه، ولم يوافق أحد على شيء بعد.",
      data: {
        orderId: updated!.id,
        partyConfiguration: updated!.partyConfiguration,
        configurationFingerprint: fingerprint,
        // Said explicitly, because this is the whole point of the column.
        offeringChanged: false,
      },
      status: "awaiting_approval",
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return clarification(error.message);
    }
    throw error;
  }
}

/**
 * «اطلبها» — the party authorizes sending THEIR OWN proposal.
 *
 *   SELECTION != PROPOSAL · PROPOSAL != AGREEMENT
 *   A PARTY MAY AUTHORIZE THEIR OWN PROPOSAL.
 *   THEY MAY NOT MANUFACTURE THE OTHER PARTY'S ACCEPTANCE.
 *
 * This is the bridge, and it is composition rather than a new chain: the
 * selection resolves to the canonical offering, an ordinary need is expressed,
 * the EXISTING match and engagement machinery derives the parties from the
 * matched expressions, and the EXISTING term-sheet proposal is what comes out.
 * Nothing here creates an agreement, a commitment, a transaction or a payment,
 * and the counterparty's decision remains theirs to make through the path it
 * always went through.
 *
 *   NEW_PROPOSAL_RUNTIME_ADDED = 0
 */
async function proposeTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:order");
  if (!binding || binding.targetKind !== "commercial_order") {
    return clarification("لم تختر شيئاً بعد لأرسله.");
  }
  const [order] = await db.select().from(commercialOrders).where(and(
    eq(commercialOrders.id, binding.targetId),
    eq(commercialOrders.ownerId, input.ownerId),
  )).limit(1);
  if (!order) return clarification("لم أجد الطلب الحالي ضمن حسابك.");

  const offeringId = string(object(order.terms), "offeringRef");
  const offering = offeringId ? await currentOffering(db, offeringId, input.ownerId) : null;
  if (!offering) return clarification("لا يمكن إعادة قراءة العرض الأساسي الحالي.");

  // CHANGED_OFFERING → the draft is stale. The other party moved, and a stale
  // draft must never quietly become a proposal at terms nobody is offering.
  const offeringNow = termsFingerprint(publicTerms(offering));
  if (order.offeringFingerprint && order.offeringFingerprint !== offeringNow) {
    return {
      kind: "structured_result",
      label: "Offer changed",
      summary: "تغيّر العرض منذ اخترته. اختر من جديد قبل أن أرسل طلبك.",
      data: { orderId: order.id, offeringChanged: true },
      status: "reapproval_required",
    };
  }

  // Idempotent on (offering, configuration): the same draft sent twice is the
  // same proposal, so a retry or a double tap never opens a second one.
  if (order.proposalId) {
    return {
      kind: "structured_result",
      label: "Proposal already sent",
      summary: "طلبك مُرسَل بالفعل وبانتظار ردّ الطرف الآخر. لم أرسل نسخة ثانية.",
      data: { orderId: order.id, proposalId: order.proposalId, counterpartyAccepted: false },
      status: "awaiting_approval",
    };
  }

  const semanticType = offering.semanticType;
  // An ordinary NEED, expressed by this party. Not a checkout object.
  //
  // THE SAME one the conversation has been about. This used to create a fresh,
  // empty expression every time, so everything the person had already said
  // about themselves — «أنا هنا», «كود البوابة كذا» — was left on an object
  // nothing downstream would ever look at again.
  //
  //   ONE_CONVERSATION_ONE_SUBJECT_OF_MINE
  const needId = await ownSubject(db, input, semanticType);
  const [need] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, needId))
    .limit(1);
  if (!need) return clarification("لم أعد أجد ما تطلبه لك.");
  // The projection carries the TYPE and nothing else. Attributes the person
  // stated about themselves stay exactly where they were.
  //
  //   STATING_IS_NOT_PUBLISHING
  await publishExpression({
    id: need.id,
    ownerId: input.ownerId,
    projection: { semanticType, summary: "احتياج" },
  });
  const match = await matchNeedToOffering({
    needId: need.id,
    offeringId: offering.id,
    createdByOwnerId: input.ownerId,
  });
  // The need this attempt comes from, read from canonical state at the moment
  // the attempt is made. The model never supplies it.
  //
  //   MODEL_CAN_BIND_TRANSACTION_TO_NEED = NO
  const { currentNeed } = await import("../need-continuity");
  const sourceNeed = await currentNeed({
    conversationId: input.conversationId,
    scopeId: input.ownerId,
  });
  const engagement = await createEngagement({
    matchId: match.id,
    initiatorOwnerId: input.ownerId,
    // DERIVED from the authorized match. This party cannot nominate who the
    // other party is.
    participants: await participantsForMatch(match.id),
    ...(sourceNeed
      ? { need: { id: sourceNeed.id, revision: sourceNeed.revision } }
      : {}),
  });

  const merged = mergedProposalTerms(
    publicTerms(offering),
    order.partyConfiguration as Record<string, string | number>,
  );
  const proposal = await proposeTermSheet({
    engagementId: engagement.id,
    proposerOwnerId: input.ownerId,
    terms: termSheetFor({
      merged,
      configuration: order.partyConfiguration as Record<string, string | number>,
      proposer: input.ownerId,
      counterparty: offering.ownerId,
    }),
  });

  await db
    .update(commercialOrders)
    .set({ proposalId: proposal.id })
    .where(eq(commercialOrders.id, order.id));

  // ── WHAT A TURN CREATES, A LATER TURN MUST BE ABLE TO NAME ──────────────
  //
  // Traced before this phase: this function created an engagement, a need and
  // a proposal, bound NONE of them, and returned. Every later sentence —
  // «اسأله إن كانت ما زالت موجودة», «أرسل له موقعي» — had nothing to refer to,
  // so the whole second half of the conversation was unreachable from the
  // conversation.
  //
  //   WHAT_A_TURN_CREATES_IS_NAMEABLE
  //
  // The keys are generic. There is no `current:mechanic` and no `current:car`.
  for (const [referenceKey, targetKind, targetId] of [
    ["current:engagement", "engagement", engagement.id],
    ["current:counterparty_offering", "economic_expression", offering.id],
    ["current:need", "economic_expression", need.id],
    ["current:proposal", "economic_proposal", proposal.id],
  ] as const) {
    await bindReference(db, {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      referenceKey,
      targetKind,
      targetId,
    });
  }

  return {
    kind: "structured_result",
    label: "Proposal sent",
    summary:
      "أرسلتُ طلبك إلى الطرف الآخر. لم يوافق أحد بعد، ولم ينشأ اتفاق ولا التزام ولا معاملة ولا دفع.",
    data: {
      orderId: order.id,
      engagementId: engagement.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      // Named rather than implied. A sent proposal is not a deal.
      counterpartyAccepted: false,
      agreementCreated: false,
      transactionCreated: false,
    },
    status: "awaiting_approval",
  };
}

/**
 * The merged terms, as the term sheet the agreement runtime already speaks.
 *
 * Two obligations, one each way, and one term for each value this party
 * stated. `settlement` and `provision` name DIRECTIONS of obligation, not
 * things: what is owed in money and what is owed in return. Nothing here knows
 * what is being exchanged.
 *
 *   DOMAIN_PROPOSAL_TYPES_ADDED = 0
 */
function termSheetFor(input: {
  merged: Record<string, unknown>;
  configuration: Record<string, string | number>;
  proposer: string;
  counterparty: string;
}): unknown[] {
  const money = object(input.merged.money);
  const amountMinor = typeof money.amountMinor === "string" ? money.amountMinor : undefined;
  const currency = typeof money.currency === "string" ? money.currency : undefined;

  const terms: Record<string, unknown>[] = [];
  if (amountMinor && currency && /^[0-9]+$/u.test(amountMinor) && BigInt(amountMinor) > 0n) {
    terms.push({
      key: "settlement",
      kind: "NUMBER",
      value: Number(amountMinor),
      unit: "minor",
      owedBy: input.proposer,
      owedTo: input.counterparty,
      evidence: "INTERNAL_STATE",
      subjectKind: "obligation",
      subjectId: "settlement",
      settlement: { amountMinor, currency },
    });
  }
  terms.push({
    key: "provision",
    kind: "NUMBER",
    value: 1,
    unit: "unit",
    owedBy: input.counterparty,
    owedTo: input.proposer,
    evidence: "HUMAN_ACTION",
    subjectKind: "obligation",
    subjectId: "provision",
  });
  for (const [key, value] of Object.entries(input.configuration)) {
    terms.push({
      key,
      kind: typeof value === "number" ? "NUMBER" : "CHOICE",
      value,
      owedBy: input.counterparty,
      owedTo: input.proposer,
      evidence: "HUMAN_ACTION",
      subjectKind: "obligation",
      subjectId: "provision",
    });
  }
  return terms;
}

function clarification(summary: string): ConversationCommerceResult {
  return {
    kind: "structured_result",
    label: "Clarification required",
    summary,
    data: { effects: "none" },
    status: "awaiting_input",
  };
}

async function approveOrder(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:order");
  if (!binding || binding.targetKind !== "commercial_order") return clarification("لا يوجد طلب حالي للموافقة عليه.");
  const [order] = await db.select().from(commercialOrders).where(and(
    eq(commercialOrders.id, binding.targetId),
    eq(commercialOrders.ownerId, input.ownerId),
  )).limit(1);
  if (!order) return clarification("لم أجد الطلب الحالي ضمن حسابك.");
  const offeringId = string(object(order.terms), "offeringRef");
  const offering = offeringId ? await currentOffering(db, offeringId, input.ownerId) : null;
  if (!offering) return clarification("لا يمكن إعادة قراءة العرض الأساسي الحالي.");
  const currentTerms: Record<string, unknown> = { offeringRef: offering.id, offeringVersion: offering.version, ...publicTerms(offering) };
  if (termsFingerprint(currentTerms) !== order.termsFingerprint) {
    const updated = await updateCommercialTerms(db, {
      id: order.id,
      terms: currentTerms,
      expectedVersion: order.termsVersion,
    });
    return {
      kind: "structured_result",
      label: "Terms changed",
      summary: "تغيرت الشروط منذ عرضها. حُدثت المسودة ويجب مراجعتها والموافقة عليها من جديد.",
      data: { orderId: updated.id, terms: updated.terms, termsFingerprint: updated.termsFingerprint },
      status: "reapproval_required",
    };
  }
  const money = moneyFrom({ money: object(currentTerms.money) });
  if (!money) return clarification("لا تحتوي الشروط الحالية على مبلغ صالح بوحدات صغرى وعملة.");
  const payment = await createPaymentIntent(db, {
    ownerId: input.ownerId,
    payerRef: input.ownerId,
    payeeRef: order.sellerRef,
    amountMinor: money.amountMinor,
    currency: money.currency,
    purpose: `commercial_order:${order.id}`,
    orderId: order.id,
    // Column is varchar(32): persist a stable hash of the approval decision id.
    authorizationRequirement: `EA:${termsFingerprint({ approval: input.envelope.decisionId }).slice(0, 29)}`,
    providerConstraints: {
      approvedOrderFingerprint: order.termsFingerprint,
      approvedOfferingFingerprint: termsFingerprint(publicTerms(offering)),
      approvedOfferingVersion: offering.version,
    },
    idempotencyKey: `conversation-order:${order.id}:${order.termsFingerprint}`,
  });
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:payment",
    targetKind: "payment_intent",
    targetId: payment.intent.id,
  });
  return {
    kind: "structured_result",
    label: "Payment intent created",
    // Said in the sentence the person reads, not only in a field they will not
    // look at: pinning an amount is not ordering, and nobody has agreed.
    //
    //   PAYMENT_INTENT_AS_ORDER_SUCCESS = 0
    summary:
      "ثُبتت موافقتك على البصمة الحالية وأُنشئت نية دفع فقط؛ لم يحدث دفع، ولم يوافق الطرف الآخر، ولم ينشأ اتفاق ولا التزام ولا معاملة.",
    data: {
      orderId: order.id,
      paymentIntentId: payment.intent.id,
      paymentStatus: payment.intent.status,
      effects: "none",
      // A pinned authorization is not any of these, and says so.
      counterpartyAccepted: false,
      agreementCreated: false,
      commitmentCreated: false,
      transactionCreated: false,
    },
    status: "completed",
  };
}

/**
 * «ادفع» — and the one question that must be answered before any surface opens:
 *
 *   WHAT EXACT CANONICAL OBLIGATION IS THIS PAYMENT SATISFYING?
 *
 * The answer comes from the agreement runtime's own output — an open
 * settlement commitment this scope owes on an open transaction — and from
 * nowhere else. Not from the draft, not from the offering projection, not from
 * the presentation, not from the client payload, not from the model.
 *
 *   COMMERCIAL_ORDER_AS_PAYMENT_AUTHORITY = NO
 *   MODEL_AS_PAYMENT_AUTHORITY = NO
 *
 * The pre-agreement payment intent that an approval may have created is
 * deliberately NOT consulted here. It records that a person approved a
 * fingerprint; it is not a payable basis, and it carries no transaction. A
 * payment intent this path prepares is bound to the transaction, and that
 * binding is what makes it executable at all.
 */
async function payTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  // A reference may POINT at which obligation is meant. It never grants the
  // right to pay it — `resolvePayable` re-checks it against what this scope
  // actually owes.
  const transactionRef = string(values, "transactionRef", "transactionId");
  const resolution = await resolvePayable(db, {
    scopeId: input.ownerId,
    transactionRef,
  });

  if (resolution.status === "NONE") {
    // The honest refusal, and the one this phase exists to produce. Nothing
    // about a draft, an approval or a sent proposal makes a payment path.
    return {
      kind: "structured_result",
      label: "No payable obligation",
      summary:
        "لا يوجد التزام مالي قائم لأدفعه. الدفع يقابل التزاماً نشأ عن اتفاق قَبِله الطرف الآخر — والاختيار أو الموافقة على مسودتك أو إرسال طلبك ليس اتفاقاً.",
      data: {
        effects: "none",
        payableObligation: null,
        reason: "NO_PAYABLE_OBLIGATION",
      },
      status: "blocked",
    };
  }

  if (resolution.status === "AMBIGUOUS") {
    //   AMBIGUOUS_PAYMENT_TARGET_GUESS = 0
    return {
      kind: "structured_result",
      label: "Which obligation",
      summary: `عليك ${resolution.candidates.length} التزامات مالية قائمة. حدد أيها تقصد قبل أن أهيّئ الدفع.`,
      data: {
        effects: "none",
        candidates: resolution.candidates.map((entry) => ({
          transactionId: entry.transactionId,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
      },
      status: "awaiting_input",
    };
  }

  const payable = resolution.payable;
  // Every financial field comes from the accepted settlement commitment. The
  // client named at most WHICH obligation; it named none of these.
  const payment = await createPaymentIntent(db, {
    ownerId: input.ownerId,
    payerRef: input.ownerId,
    payeeRef: payable.payeeRef,
    amountMinor: payable.amountMinor,
    currency: payable.currency,
    purpose: `settlement:${payable.commitmentId}`,
    transactionId: payable.transactionId,
    // Stable per obligation: the same obligation paid twice prepares one
    // intent, so a retry or a double tap cannot open a second.
    idempotencyKey: `settlement:${payable.commitmentId}`,
  });
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:payment",
    targetKind: "payment_intent",
    targetId: payment.intent.id,
  });

  // ── WHOSE RAIL, AND WHO DECIDED ─────────────────────────────────────────
  //
  // This read used to be `string(values, "provider")` and
  // `string(values, "adapterEndpoint")` — the MODEL's envelope. The URL it
  // produced was origin-checked, so it could not point anywhere, and it was
  // still the model choosing which payment provider carried somebody's money.
  //
  //   MODEL != PAYMENT ROUTE AUTHORITY
  //   PAYMENT_EXECUTION_BYPASSES_GENERAL_PROVIDER_BINDING = 0
  //
  // The route is now derived from the canonical settlement: the two sides of
  // the payable, each offering only its OWN verified, PAY-granted bindings.
  // Nothing a caller says reaches it.
  const routed = await paymentExecutionRoute({
    payable: { payeeRef: payable.payeeRef },
    payerScopeId: input.ownerId,
  });

  if (routed.status !== "RESOLVED") {
    // No route is not a failed payment and not a fake success. The obligation
    // stands, the intent exists, and nothing was charged.
    //
    //   NO_PROVIDER_FAKE_PAYMENT_SUCCESS = 0
    return {
      kind: "structured_result",
      label: "Payment prepared",
      summary:
        routed.status === "AMBIGUOUS_ROUTE"
          ? "هيّأتُ الدفع مقابل التزام قائم. أكثر من مسار دفع موثوق ممكن، ولن أختار نيابة عنك."
          : "هيّأتُ الدفع مقابل التزام قائم ومحدد. لم يحدث دفع: لا يوجد مسار دفع موثوق ومتحقق منه بعد.",
      data: {
        paymentIntentId: payment.intent.id,
        transactionId: payable.transactionId,
        commitmentId: payable.commitmentId,
        amountMinor: payable.amountMinor,
        currency: payable.currency,
        paymentTruth: "UNCHANGED",
        paymentRoute: routed.status,
        effects: "none",
      },
      status: "awaiting_input",
    };
  }

  // A route exists. That is still not a payment: the intent is prepared and
  // pinned to nothing until an execution actually claims it.
  //
  //   PAYMENT_INTENT != PAYMENT_EXECUTION
  //   PAYABLE_OBLIGATION != SILENT_CHARGE_AUTHORITY
  return {
    kind: "structured_result",
    label: "Payment route ready",
    summary:
      "هيّأتُ الدفع، وهناك مسار دفع موثوق ومتحقق منه. لم يُخصم شيء بعد — التنفيذ يحتاج تفويضك عبر المسار الموثوق.",
    data: {
      paymentIntentId: payment.intent.id,
      transactionId: payable.transactionId,
      commitmentId: payable.commitmentId,
      amountMinor: payable.amountMinor,
      currency: payable.currency,
      // The definition and the side. Never the binding's credential, never an
      // endpoint, and never anything the model could reuse as a route.
      paymentRoute: "RESOLVED",
      routeProvider: routed.route.definitionId,
      routeSide: routed.route.side,
      paymentTruth: "UNCHANGED",
      effects: "none",
    },
    status: "awaiting_input",
  };
}

async function worldCommerceTurn(
  db: NodePgDatabase<any>,
  worlds: GeneratedWorldService,
  input: { ownerId: string; conversationId: string; content: string; approvalRef: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const ownerNumericId = Number(input.ownerId);
  const conversationNumericId = Number(input.conversationId);
  if (!Number.isSafeInteger(ownerNumericId) || !Number.isSafeInteger(conversationNumericId)) {
    return clarification("تعذر ربط المحادثة بعالم مملوك صالح.");
  }
  const values = input.envelope.intent?.inputs ?? {};
  const requestedWorld = string(values, "worldRef", "worldId");
  const world = requestedWorld ? await worlds.get(ownerNumericId, requestedWorld) : undefined;
  if (requestedWorld && !world) return clarification("العالم المطلوب غير موجود أو غير مملوك لك.");
  const worldId = world?.worldKey ?? (await worlds.conversationWorld(ownerNumericId, conversationNumericId))?.id;
  if (!worldId) return clarification("حدد عالماً مملوكاً أو اربط هذه المحادثة بعالم قبل تعديل اقتصادياته.");
  let targetPlanId = string(values, "planId", "targetId");
  const requestedMutation = object(values.mutation);
  const flatMutation: Record<string, unknown> = {};
  for (const key of ["priceMinor", "currency", "name", "cadence", "status", "trialPolicy", "usagePolicy", "entitlementScopes"]) {
    if (values[key] !== undefined) flatMutation[key] = values[key];
  }
  const mutation = {
    ...flatMutation,
    ...requestedMutation,
    ...(/(?:أوقف|اوقف|\bstop\b)/u.test(input.content.toLowerCase()) && requestedMutation.status === undefined
      ? { status: "PAUSED" }
      : {}),
  };
  const addingPlan = /(?:^|\s)(?:أضف|اضف|add)(?:\s|$)/u.test(input.content.toLowerCase());
  if (!addingPlan && !targetPlanId && Object.keys(mutation).length > 0) {
    const targetName = string(values, "targetName", "planName");
    const candidates = await db.select().from(plans).where(and(
      eq(plans.ownerId, input.ownerId),
      eq(plans.worldId, worldId),
      targetName ? eq(plans.name, targetName) : undefined,
    )).limit(2);
    if (candidates.length === 1) targetPlanId = candidates[0]!.id;
    else if (candidates.length > 1) return clarification("توجد عدة خطط في العالم؛ حدد الخطة المطلوب تعديلها.");
    else return clarification("لم أجد خطة مطابقة في العالم المملوك لتطبيق التغيير.");
  }
  if (targetPlanId) {
    const [plan] = await db.select().from(plans).where(and(
      eq(plans.id, targetPlanId),
      eq(plans.ownerId, input.ownerId),
      eq(plans.worldId, worldId),
    )).limit(1);
    if (!plan) return clarification("لم أجد الخطة المطلوبة في العالم المملوك.");
    const applied = await applyApprovedCommercialChange(db, {
      targetType: "plan",
      targetId: plan.id,
      mutation,
      approvalRef: input.approvalRef,
      expectedVersion: plan.version,
      ownerId: input.ownerId,
    });
    return {
      kind: "structured_result",
      label: "World commerce updated",
      summary: "طُبق التغيير المعتمد على الخطة المرتبطة بالعالم نفسه مع إصدار جديد.",
      data: { worldRef: worldId, planId: plan.id, newVersion: applied.newVersion },
      status: "completed",
    };
  }
  const money = moneyFrom(values);
  const plan = await createWorldPlan(db, worlds, {
    ownerId: input.ownerId,
    ownerNumericId,
    worldId,
    name: string(values, "name", "subject") ?? "Default",
    priceMinor: money?.amountMinor ?? null,
    currency: money?.currency ?? null,
    cadence: string(values, "cadence") ?? "MONTHLY",
    entitlementScopes: Array.isArray(values.entitlementScopes)
      ? values.entitlementScopes as Array<Record<string, unknown>>
      : [],
  });
  return {
    kind: "structured_result",
    label: "World plan added",
    summary: "أُضيفت خطة تجارية إلى العالم المملوك نفسه دون إعادة توليده.",
    data: { worldRef: worldId, planId: plan.id, version: plan.version },
    status: "completed",
  };
}

/**
 * THE ONE THING OF MINE THIS CONVERSATION IS ABOUT.
 *
 * Created on first use and bound, so «أنا هنا» said before the search and
 * «أرسل له موقعي» said after the agreement reach the SAME subject. Before this
 * the turn path created a fresh, empty need at proposal time and everything the
 * person had said about themselves went nowhere.
 *
 *   ONE_CONVERSATION_ONE_SUBJECT_OF_MINE
 */
async function ownSubject(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string },
  semanticType: string,
): Promise<string> {
  const bound = await activeBinding(db, input.ownerId, input.conversationId, "current:need");
  if (bound) {
    const [row] = await db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.id, bound.targetId))
      .limit(1);
    if (row && row.ownerId === input.ownerId) {
      // ── A FACT ABOUT ME OUTLIVES WHAT I AM LOOKING FOR ──────────────────
      //
      // The TYPE follows the current pursuit — «أنا عند الدوار» said before
      // any search leaves the subject untyped, and the search that follows is
      // what says what it is about. The ATTRIBUTES do not move: where I am and
      // what my gate code is are true of me whatever I happen to be asking
      // for, and dropping them on a retype would throw away the person's own
      // words for no reason.
      //
      //   A FACT ABOUT ME IS NOT A FACT ABOUT THE TOPIC
      if (row.semanticType !== semanticType) {
        await db
          .update(economicExpressions)
          .set({ semanticType, version: row.version + 1 })
          .where(eq(economicExpressions.id, row.id));
      }
      return row.id;
    }
  }
  const created = await createExpression({
    ownerId: input.ownerId,
    kind: "need",
    semanticType,
    attributes: {},
  });
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:need",
    targetKind: "economic_expression",
    targetId: created.id,
  });
  return created.id;
}

/**
 * «أنا عند الدوار الخامس» · «رقمي كذا» · «كود البوابة 8821».
 *
 * A fact about MY thing, recorded on my thing. Traced before this phase: no
 * turn wrote an attribute anywhere, so the need a conversation created was
 * permanently empty — proximity had no origin to search from and disclosure
 * had nothing to release. The person could say it and JASIM had nowhere to put
 * it.
 *
 *   A FACT ABOUT ME IS NOT A REQUIREMENT OF THEM
 *   MODEL_EXTRACTION != OWNER_DECLARATION — it lands INFERRED, and an INFERRED
 *   value already decides nothing until the person confirms this exact one.
 */
async function stateTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const values = input.envelope.intent?.inputs ?? {};
  const field = string(values, "field", "property", "attribute");
  if (!field) return clarification("أي تفصيل عنك تريدني أن أسجّله؟");
  const value = values.value ?? values[field];
  if (value === undefined || value === null) {
    return clarification(`وما قيمة «${field}»؟`);
  }
  const semanticType = string(values, "subject", "semanticType") ?? "احتياج";
  const subjectId = await ownSubject(db, input, semanticType);
  const updated = await stateOwnAttribute({
    expressionId: subjectId,
    ownerId: input.ownerId,
    field,
    value,
  });
  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:statement",
    targetKind: "pending_statement",
    // The exact reading being confirmed. A later confirmation cannot promote a
    // different field than the one shown.
    targetId: `${subjectId}|${field}`,
  });
  return {
    kind: "structured_result",
    label: "Recorded about you",
    summary:
      `سجّلتُ «${field}» عنك كما فهمتُه. هذا فهمي لكلامك لا قولك أنت، فهو لا يقرّر شيئاً حتى تؤكّده.`,
    data: {
      subjectId: updated.id,
      field,
      value,
      provenance: "INFERRED",
      // Said plainly: nothing about this is visible to anybody else.
      published: false,
      decidesNothingYet: true,
    },
    status: "awaiting_approval",
  };
}

/** «نعم، هذا هو» — the moment the person actually declared it. */
async function confirmStateTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult | null> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:statement");
  if (!binding || binding.targetKind !== "pending_statement") return null;
  const [subjectId, field] = binding.targetId.split("|");
  if (!subjectId || !field) return null;
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, subjectId))
    .limit(1);
  if (!row || row.ownerId !== input.ownerId) return null;
  const value = (row.attributes as Record<string, unknown>)[field];
  if (value === undefined) return null;
  // Read back rather than remembered: what is promoted is what is THERE now.
  const updated = await stateOwnAttribute({
    expressionId: subjectId,
    ownerId: input.ownerId,
    field,
    value,
    provenance: "STATED",
  });
  return {
    kind: "structured_result",
    label: "Stated",
    summary: `الآن «${field}» قولك أنت، وأستطيع أن أبني عليه.`,
    data: {
      subjectId: updated.id,
      field,
      value,
      provenance: "STATED",
      published: false,
    },
    status: "completed",
  };
}

/**
 * «اسأله إن كانت ما زالت موجودة» — carry a question to the other party.
 *
 * The brokering runtime has existed since its own phase and NOTHING called it:
 * a buyer could not ask a seller anything from inside the conversation. This
 * is the door, and it is four lines of resolution around a runtime that
 * already refuses everything it should.
 *
 *   QUESTION_LEAKS_ASKER_IDENTITY = 0 — enforced by the runtime, not here.
 */
async function askCounterpartyTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; content: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const engagement = await activeBinding(db, input.ownerId, input.conversationId, "current:engagement");
  if (!engagement || engagement.targetKind !== "engagement") {
    return clarification("لا توجد محادثة قائمة مع طرف آخر لأحمل إليه سؤالك.");
  }
  const subject = await activeBinding(
    db, input.ownerId, input.conversationId, "current:counterparty_offering",
  );
  if (!subject) return clarification("لا أعرف عن أي شيء تسأل.");

  // WHICH property. Derived from the classified envelope, never free text: a
  // question is about a named attribute of a named thing, and a model that
  // could write the sentence could write anything into somebody's inbox.
  //
  //   MODEL_WRITES_THE_QUESTION_TEXT = 0
  const property = string(input.envelope.intent?.inputs ?? {}, "property", "field", "about");
  if (!property) return clarification("عن أي تفصيل تريدني أن أسأله؟");

  try {
    const asked = await askCounterparty({
      engagementId: engagement.targetId,
      askedByOwnerId: input.ownerId,
      subjectExpressionId: subject.targetId,
      property,
    });
    return {
      kind: "structured_result",
      label: "Question carried",
      summary:
        "حملتُ سؤالك إلى الطرف الآخر. لم يُجب بعد، وجوابه حين يأتي يكون قوله هو لا حقيقة مثبتة.",
      data: {
        questionId: asked.questionId,
        property: asked.property,
        answered: false,
        // Named rather than implied, because the difference is the whole point.
        answerIsEvidenceNotFact: true,
      },
      status: "awaiting_input",
    };
  } catch (error) {
    return clarification(
      error instanceof Error ? error.message : "لا أستطيع حمل هذا السؤال.",
    );
  }
}

/** «ماذا ردّ؟» — what came back, and whether it still describes the thing. */
async function counterpartyAnswersTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const engagement = await activeBinding(db, input.ownerId, input.conversationId, "current:engagement");
  if (!engagement || engagement.targetKind !== "engagement") {
    return clarification("لا توجد محادثة قائمة مع طرف آخر لأقرأ ردّه.");
  }
  const answers = await currentAnswersFor({
    engagementId: engagement.targetId,
    askedByOwnerId: input.ownerId,
  });
  const answered = answers.filter((entry) => entry.answer !== undefined);
  return {
    kind: "structured_result",
    label: "Counterparty answers",
    summary:
      answered.length === 0
        ? "لم يصل ردّ بعد."
        : "هذا ما قاله الطرف الآخر. قوله دليل، لا صفة مثبتة على الشيء.",
    data: {
      answers: answers.map((entry) => ({
        questionId: entry.questionId,
        property: entry.property,
        answer: entry.answer?.value ?? null,
        status: entry.status,
        // An answer given about an older version no longer describes this.
        //   ANSWER_SURVIVES_SUBJECT_REVISION = 0
        stale: entry.stale,
      })),
      pending: answers.length - answered.length,
    },
    status: answered.length === 0 ? "awaiting_input" : "completed",
  };
}

/**
 * «أقبل» — the OTHER party accepting a proposal that was sent to them.
 *
 * Distinct from «أوافق», which pins one's own draft. Traced: `commitAgreement`
 * was called from no turn at all, so a conversation could send a proposal and
 * could never become an agreement. That is the step every later one needs.
 */
async function acceptProposalTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult | null> {
  // Proposals in engagements this party belongs to, that this party did NOT
  // make. Read from canonical state; the envelope names none of it.
  const rows = await db
    .select({ proposal: economicProposals, engagement: economicEngagements })
    .from(economicProposals)
    .innerJoin(
      economicEngagements,
      eq(economicEngagements.id, economicProposals.engagementId),
    )
    .where(eq(economicProposals.status, "proposed"))
    .orderBy(desc(economicProposals.createdAt))
    .limit(50);
  const mine = rows.filter(
    (row) =>
      row.engagement.participants.includes(input.ownerId) &&
      row.proposal.proposerOwnerId !== input.ownerId,
  );
  if (mine.length === 0) return null;
  if (mine.length > 1) {
    //   AMBIGUOUS_ACCEPTANCE_GUESS = 0 — accepting the wrong one binds somebody
    //   to terms they never read.
    return {
      kind: "structured_result",
      label: "Which proposal",
      summary: `أمامك ${mine.length} عروض قائمة. حدد أيها تقبل.`,
      data: {
        effects: "none",
        proposals: mine.map((row) => ({ proposalId: row.proposal.id, version: row.proposal.version })),
      },
      status: "awaiting_input",
    };
  }

  const chosen = mine[0]!;
  // ── A CLASSIFIED SENTENCE IS NOT A PERSON READING TERMS ──────────────────
  //
  // This set the direct-acceptance flag until an inherited ratchet caught it,
  // and the ratchet was right. That flag means THE OWNER THEMSELVES IS
  // ACCEPTING, NOW — it is reserved for the two places a person is provably
  // present: the API surface they clicked, and the authority act whose
  // statement they read term by term before citing its digest. The ratchet
  // greps for the literal, so this comment deliberately does not spell it.
  //
  // A turn is neither. The model decided that «أقبل» meant accept; a model
  // that could raise that flag would bind somebody to a term sheet by
  // classifying a sentence.
  //
  //   MODEL != AUTHORITY · CLASSIFICATION != ACCEPTANCE
  //
  // So acceptance from a conversation goes through the ENVELOPE basis: bounds
  // this party set in advance, evaluated against the incoming terms, refusing
  // anything past the reserve. JASIM may say yes for you only inside limits
  // you set yourself — and when you set none, it says so instead of guessing.
  let committed;
  try {
    committed = await commitAgreement({
      proposalId: chosen.proposal.id,
      ownerId: input.ownerId,
    });
  } catch (error) {
    return {
      kind: "structured_result",
      label: "Cannot accept for you",
      summary:
        "لا أستطيع أن أقبل نيابةً عنك من جملة في المحادثة. اقبله بنفسك، أو اضبط لي حدودك مسبقاً فأقبل ضمنها وحدها.",
      data: {
        effects: "none",
        proposalId: chosen.proposal.id,
        agreementCreated: false,
        reason: error instanceof Error ? error.message : "NO_ACCEPTANCE_AUTHORITY",
      },
      status: "blocked",
    };
  }
  // ── AN AGREEMENT IS HELD BY EVERY PARTY TO IT ───────────────────────────
  //
  // Bound for each participant, not only for whoever happened to say yes. A
  // draft is one person's; an agreement is the thing both of them are now
  // inside, and the other party must be able to name it on their next turn —
  // otherwise «أرسل له موقعي» from the buyer finds no agreement a moment after
  // the seller accepted.
  //
  // Not a leak: the participants are read from the agreement itself, and each
  // party learns only that the agreement they are already party to exists.
  for (const participant of committed.agreement.participants) {
    await bindReference(db, {
      ownerId: participant,
      conversationId: input.conversationId,
      referenceKey: "current:agreement",
      targetKind: "agreement",
      targetId: committed.agreement.id,
    });
  }
  return {
    kind: "structured_result",
    label: "Agreement reached",
    summary:
      "قبلتَ العرض، فنشأ اتفاق والتزامات. لم يُدفع شيء ولم يُنفَّذ شيء بعد.",
    data: {
      agreementId: committed.agreement.id,
      commitments: committed.commitments.length,
      // AGREEMENT != TRANSACTION != FULFILLMENT. Said, not implied.
      paid: false,
      fulfilled: false,
    },
    status: "completed",
  };
}

/**
 * «أرسل له موقعي» — release one private field to the party you agreed with.
 *
 * TWO turns, deliberately. The model extracted WHICH field from a sentence,
 * and a released address cannot be un-released:
 *
 *   MODEL_EXTRACTION != OWNER_DECLARATION
 *
 * So the first turn shows exactly what will be released and to whom, and the
 * second performs it. The same discipline as publishing a statement.
 */
async function discloseTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const pending = await pendingDisclosure(db, input);
  if ("clarify" in pending) return pending.clarify;
  const { agreementRow, subjectId, field, value, recipient, provenance } = pending;

  await bindReference(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    referenceKey: "current:disclosure",
    targetKind: "pending_disclosure",
    // The exact release, named in the binding itself, so confirming cannot
    // release a different field to a different person than the one shown.
    targetId: `${agreementRow.id}|${subjectId}|${field}|${recipient}`,
  });
  return {
    kind: "structured_result",
    label: "Release this?",
    summary:
      provenance === "STATED"
        ? `سأرسل «${field}» كما ذكرتَه، إلى الطرف الذي اتفقتَ معه ولا أحد غيره. راجعه — لا يمكن سحب ما وصل.`
        : `سأرسل «${field}» كما فهمتُه من كلامك، لا كما ذكرتَه أنت. راجعه بدقّة قبل أن أرسل — لا يمكن سحب ما وصل.`,
    data: {
      field,
      value,
      recipientOwnerId: recipient,
      agreementId: agreementRow.id,
      // WHOSE WORD this is. Releasing a model's reading of a sentence as
      // though the person had stated it is the difference that matters most
      // at the exact moment it leaves.
      //
      //   MODEL_EXTRACTION != OWNER_DECLARATION
      provenance,
      released: false,
      effects: "none",
    },
    status: "awaiting_approval",
  };
}

/** The confirmation. Reads the pinned release back rather than remembering it. */
async function confirmDiscloseTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult | null> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:disclosure");
  if (!binding || binding.targetKind !== "pending_disclosure") return null;
  const [agreementId, subjectId, field, recipient] = binding.targetId.split("|");
  if (!agreementId || !subjectId || !field || !recipient) return null;
  try {
    const released = await discloseToCounterparty(db, {
      agreementId,
      discloserOwnerId: input.ownerId,
      subjectKind: DISCLOSABLE_SUBJECT_KIND,
      subjectId,
      field,
      recipientOwnerId: recipient,
    });
    return {
      kind: "structured_result",
      label: "Released",
      summary:
        `أرسلتُ «${field}» إلى الطرف الذي اتفقتَ معه وحده. لم يتغيّر أي شيء معروض للعامة.`,
      data: {
        disclosureId: released.id,
        field: released.field,
        recipientOwnerId: released.recipientOwnerId,
        released: true,
        published: false,
      },
      status: "completed",
    };
  } catch (error) {
    if (error instanceof DisclosureError) return clarification(error.message);
    throw error;
  }
}

/** What a release WOULD be, read from canonical state at the moment asked. */
async function pendingDisclosure(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<
  | { clarify: ConversationCommerceResult }
  | {
      agreementRow: { id: string; participants: string[] };
      subjectId: string;
      field: string;
      value: unknown;
      recipient: string;
      provenance: string;
    }
> {
  const bound = await activeBinding(db, input.ownerId, input.conversationId, "current:agreement");
  if (!bound || bound.targetKind !== "agreement") {
    //   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY — being in a conversation with
    //   somebody has never been permission to learn where you are.
    return {
      clarify: clarification(
        "لم ينشأ اتفاق بعد. لا أرسل شيئاً خاصاً قبل أن يوافق الطرف الآخر ويلتزم.",
      ),
    };
  }
  const [agreementRow] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, bound.targetId))
    .limit(1);
  if (!agreementRow) return { clarify: clarification("لم أعد أجد الاتفاق الحالي.") };

  const subjectBinding = await activeBinding(db, input.ownerId, input.conversationId, "current:need");
  if (!subjectBinding) return { clarify: clarification("لا أعرف عن أي شيء لك تتحدث.") };

  const field = string(input.envelope.intent?.inputs ?? {}, "field", "property", "attribute");
  if (!field) return { clarify: clarification("أي تفصيل تريدني أن أرسله؟") };

  const [subject] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, subjectBinding.targetId))
    .limit(1);
  if (!subject || subject.ownerId !== input.ownerId) {
    return { clarify: clarification("هذا ليس شيئاً تملكه لترسله.") };
  }
  const value = (subject.attributes as Record<string, unknown>)[field];
  if (value === undefined || value === null) {
    //   DISCLOSING_WHAT_IS_NOT_THERE = 0
    return {
      clarify: clarification(`لم تخبرني بـ«${field}» بعد، فليس عندي ما أرسله.`),
    };
  }
  const others = agreementRow.participants.filter((party) => party !== input.ownerId);
  if (others.length !== 1) {
    return { clarify: clarification("حدد لمن أرسله من أطراف الاتفاق.") };
  }
  const provenance =
    ((subject.attributeProvenance ?? {}) as Record<string, string>)[field] ?? "INFERRED";
  return { agreementRow, subjectId: subject.id, field, value, recipient: others[0]!, provenance };
}

/**
 * Trusted, generic bridge from an untrusted classified envelope to Block 3.1
 * discovery and the canonical Block 3 state machines.
 */
export async function orchestrateConversationCommerce(input: {
  db: NodePgDatabase<any>;
  worlds: GeneratedWorldService;
  ownerId: string;
  conversationId: string;
  content: string;
  /** Server-persisted user message identity; never supplied by the planner. */
  approvalRef: string;
  envelope: IntentEnvelope;
}): Promise<ConversationCommerceResult | null> {
  const text = input.content.toLowerCase();
  const isPay = hasLabel(input.envelope, /commerce[-_: ]?pay|payment[-_: ]?checkout/) || /^(?:ادفع(?:\s|$)|pay\b|checkout\b)/u.test(text.trim());
  const explicitApproval = /^(?:أوافق(?:\s|$)|اوافق(?:\s|$)|موافق(?:\s|$)|approve\b|confirm\b)/u.test(text.trim());
  const isApprove = explicitApproval &&
    (hasLabel(input.envelope, /commerce[-_: ]?approve|order[-_: ]?approve/) || explicitApproval);
  const isSelect = hasLabel(input.envelope, /commerce[-_: ]?select|candidate[-_: ]?select/) ||
    (ordinal(text) !== null && /خذ|اختر|احجز|select|choose|take/u.test(text));
  const explicitPublish = /(?:^|\s)(?:انشر|اعرض|أبيع|ابيع|sell|publish)(?:\s|$)/u.test(text);
  const isPublish = explicitPublish &&
    (hasLabel(input.envelope, /commerce[-_: ]?publish|expression[-_: ]?publish/) || explicitPublish);
  const explicitWorldMutation = /(?:^|\s)(?:أضف|اضف|غيّر|غير|أوقف|اوقف|add|change|update|stop)(?:\s|$)/u.test(text);
  const isWorldCommerce =
    hasLabel(input.envelope, /world[-_: ]?commerce|commercial[-_: ]?changeset|world[-_: ]?plan|subscription/) &&
    explicitWorldMutation;
  const isCompare =
    hasLabel(input.envelope, /commerce[-_: ]?compare|discovery[-_: ]?compare|comparison/) ||
    /(?:^|\s)(?:قارن|compare)(?:\s|$)/u.test(text);
  // Stating values for terms an offering left open. Checked before selection
  // and before discovery: configuring names no ordinal and searches for
  // nothing, and must never be mistaken for either.
  const isConfigure = hasLabel(input.envelope, /commerce[-_: ]?configure|terms[-_: ]?configure/);
  // Authorizing the party's OWN proposal. Deliberately NOT the approval verb:
  // «أوافق» pins a draft, «اطلبها» sends it, and neither of them is the other
  // party saying yes.
  const isPropose = hasLabel(input.envelope, /commerce[-_: ]?propose|proposal[-_: ]?send/);
  const isDiscovery = hasLabel(input.envelope, /discovery|search|find|match/) || /(?:^|\s)(?:ابحث|فتش|جد)(?:\s|$)|\b(?:search|find|discover)\b/u.test(text);
  // ── THE SECOND HALF OF A CONVERSATION ───────────────────────────────────
  //
  // Asking the other party, reading their answer, accepting what they sent,
  // and releasing something private to them. Every one of these ran on a
  // runtime that already existed and that NO turn could reach.
  const isAsk =
    hasLabel(input.envelope, /counterparty[-_: ]?ask|brokering[-_: ]?question/) ||
    /(?:^|\s)(?:اسأل(?:ه|ها)?|استفسر)(?:\s|$)|\bask\b/u.test(text);
  const isAnswers =
    hasLabel(input.envelope, /counterparty[-_: ]?answers|brokering[-_: ]?answers/) ||
    /(?:^|\s)(?:ماذا\s+رد|ما\s+رده|ردّه|جوابه)(?:\s|$)/u.test(text);
  // «أقبل» is the OTHER party saying yes to what was sent. Deliberately not
  // «أوافق», which pins one's own draft — conflating them would let a buyer's
  // confirmation of their own words look like a seller's acceptance.
  //
  //   OWN_CONFIRMATION != COUNTERPARTY_ACCEPTANCE
  const isAccept =
    hasLabel(input.envelope, /proposal[-_: ]?accept|agreement[-_: ]?commit/) ||
    /^(?:أقبل|اقبل|accept\b)/u.test(text.trim());
  const isDisclose =
    hasLabel(input.envelope, /disclosure|release[-_: ]?field/) ||
    /(?:^|\s)(?:أرسل\s+له|ارسل\s+له|أرسل\s+لها|ارسل\s+لها)(?:\s|$)/u.test(text);
  // Saying something about MYSELF. Deliberately label-driven: «أنا عند الدوار»
  // is a sentence about me, «قرب الدوار» is a requirement of them, and only
  // the classifier can tell those apart — so a keyword heuristic here would
  // turn requirements into facts about the person.
  //
  //   A FACT ABOUT ME IS NOT A REQUIREMENT OF THEM
  const isState = hasLabel(input.envelope, /self[-_: ]?state|own[-_: ]?attribute|state[-_: ]?fact/);

  // Consequential intents are checked before discovery because classifier
  // labels may contain both "search" and the requested follow-up action.
  if (isPay) return payTurn(input.db, input);
  if (isConfigure) return configureTurn(input.db, input);
  if (isPropose) return proposeTurn(input.db, input);
  // ── DESCRIBING SOMETHING IS NOT CONFIRMING SOMETHING ────────────────────
  //
  // «أوافق» confirms a pending statement. «اعرض» does too — but ONLY when the
  // turn names nothing new: a sentence that carries a subject is the seller
  // describing another thing, and reading it as a confirmation would publish
  // the previous draft and silently drop the new one.
  //
  //   A_NEW_DESCRIPTION_CONFIRMS_THE_PREVIOUS_STATEMENT = 0
  //
  // It returns null when nothing is waiting, so «أوافق» over an order still
  // reaches the order.
  const describesSomething = Boolean(
    string(input.envelope.intent?.inputs ?? {}, "subject", "semanticType", "title"),
  );
  if (explicitApproval || (explicitPublish && !describesSomething)) {
    // ── WHAT DOES «نعم» CONFIRM? ─────────────────────────────────────────
    //
    // Ordered by what a wrong answer costs. A RELEASE cannot be taken back,
    // so it is asked about first; publishing a statement to everyone is next;
    // recording a fact about yourself is private and reversible, so it is
    // last. A bare yes never reaches past the most consequential thing
    // actually waiting on it.
    //
    //   AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0
    const releasedNow = await confirmDiscloseTurn(input.db, input);
    if (releasedNow) return releasedNow;
    const confirmed = await confirmPublishTurn(input.db, input);
    if (confirmed) return confirmed;
    const stated = await confirmStateTurn(input.db, input);
    if (stated) return stated;
  }
  // Releasing and asking come before approval and selection, because both
  // name a counterparty rather than a result, and «أرسل له موقعي» must never
  // be read as picking something.
  if (isState) return stateTurn(input.db, input);
  if (isDisclose) return discloseTurn(input.db, input);
  if (isAsk) return askCounterpartyTurn(input.db, input);
  if (isAnswers) return counterpartyAnswersTurn(input.db, input);
  if (isAccept) {
    const accepted = await acceptProposalTurn(input.db, input);
    if (accepted) return accepted;
  }
  if (isApprove) return approveOrder(input.db, input);
  if (isCompare) return compareTurn(input.db, input);
  if (isSelect) return selectTurn(input.db, input);
  if (isPublish) return publishTurn(input.db, input.worlds, input);
  if (isWorldCommerce) return worldCommerceTurn(input.db, input.worlds, input);
  if (isDiscovery) return discoverTurn(input.db, input);
  return null;
}