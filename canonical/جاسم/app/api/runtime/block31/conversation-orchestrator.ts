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
import { createFinancialCheckout } from "../block3/checkout";
import { applyApprovedCommercialChange } from "../block3/commercial-changesets";
import { createWorldPlan } from "../block3/generated-business-economics";
import type { GeneratedWorldService } from "../../core/generated-world-service";
import { discover } from "./discovery";
import { bindReference, resolveOrdinal } from "./reference-bindings";
import { resolvePayable } from "./canonical-payable";

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
  const { hardConstraintsForDiscovery } = await import("../need-continuity");
  const carried = stated.length > 0
    ? stated
    : (await hardConstraintsForDiscovery({
        conversationId: input.conversationId,
        scopeId: input.ownerId,
      })) as unknown as never[];

  const found = await discover(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    query,
    kind: string(values, "kind") === "need" ? "need" : "offering",
    explicitScope: values.scope,
    availability: { internal: true, web: Array.isArray(values.webResults) },
    hardConstraints: carried,
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
    summary: found.candidates.length
      ? `وجد جاسم ${found.candidates.length} نتيجة. الأسعار الخارجية ملاحظات غير موثوقة وليست شروط دفع.`
      : "لم يجد جاسم نتائج مطابقة ضمن المصادر المتاحة.",
    data: {
      resultSetId: found.resultSet.id,
      sources: found.resultSet.sources,
      candidates: found.candidates.map(safeCandidate),
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

async function publishTurn(
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
  const expression = await createExpression({
    ownerId: input.ownerId,
    kind: "offering",
    semanticType: subject!,
    subjectEntityId: string(values, "subjectEntityId"),
    attributes: { priceMinor: money!.amountMinor, currency: money!.currency, ...(worldRef ? { worldRef } : {}) },
  });
  const published = await publishExpression({
    id: expression.id,
    ownerId: input.ownerId,
    projection: {
      semanticType: subject!,
      summary: string(values, "summary") ?? subject!,
      publicTerms,
      availability: values.availability ?? "available",
    },
  });
  return {
    kind: "structured_result",
    label: "Offering published",
    summary: "نُشر العرض بناءً على طلبك الصريح.",
    data: { expressionId: published.id, version: published.version, status: published.status, publicTerms },
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
    .set({ offeringFingerprint: termsFingerprint(publicTerms(offering)) })
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
  const need = await createExpression({
    ownerId: input.ownerId,
    kind: "need",
    semanticType,
    attributes: {},
  });
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
  const engagement = await createEngagement({
    matchId: match.id,
    initiatorOwnerId: input.ownerId,
    // DERIVED from the authorized match. This party cannot nominate who the
    // other party is.
    participants: await participantsForMatch(match.id),
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

  const provider = string(values, "provider");
  const adapterEndpoint = string(values, "adapterEndpoint");
  if (!provider || !adapterEndpoint) {
    return {
      kind: "structured_result",
      label: "Payment prepared",
      summary:
        "هيّأتُ الدفع مقابل التزام قائم ومحدد. لم يحدث دفع، ويلزم مزود دفع موثوق قبل فتح أي واجهة.",
      data: {
        paymentIntentId: payment.intent.id,
        transactionId: payable.transactionId,
        commitmentId: payable.commitmentId,
        amountMinor: payable.amountMinor,
        currency: payable.currency,
        paymentTruth: "UNCHANGED",
        effects: "none",
      },
      status: "awaiting_input",
    };
  }

  const checkout = await createFinancialCheckout(db, {
    intentId: payment.intent.id,
    ownerId: input.ownerId,
    provider,
    adapterEndpoint,
  });
  return {
    kind: "structured_result",
    label: "Checkout ready",
    summary: "أُنشئت جلسة checkout مرتبطة بالتزام قائم. فتحها لا يثبت نجاح الدفع.",
    data: {
      paymentIntentId: payment.intent.id,
      transactionId: payable.transactionId,
      commitmentId: payable.commitmentId,
      sessionId: checkout.session.id,
      checkoutUrl: checkout.checkoutUrl,
      paymentTruth: "UNCHANGED",
    },
    status: "completed",
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

  // Consequential intents are checked before discovery because classifier
  // labels may contain both "search" and the requested follow-up action.
  if (isPay) return payTurn(input.db, input);
  if (isConfigure) return configureTurn(input.db, input);
  if (isPropose) return proposeTurn(input.db, input);
  if (isApprove) return approveOrder(input.db, input);
  if (isCompare) return compareTurn(input.db, input);
  if (isSelect) return selectTurn(input.db, input);
  if (isPublish) return publishTurn(input.worlds, input);
  if (isWorldCommerce) return worldCommerceTurn(input.db, input.worlds, input);
  if (isDiscovery) return discoverTurn(input.db, input);
  return null;
}