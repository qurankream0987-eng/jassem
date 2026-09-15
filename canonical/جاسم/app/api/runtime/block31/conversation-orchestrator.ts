import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  commercialOrders,
  economicExpressions,
  paymentIntents,
  plans,
  referenceBindings,
} from "@db/schema";
import { createExpression, publishExpression } from "../economic-fabric";
import { createCommercialOrder, termsFingerprint, updateCommercialTerms } from "../block3/commercial-orders";
import { createPaymentIntent } from "../block3/payment-intents";
import { createFinancialCheckout } from "../block3/checkout";
import { applyApprovedCommercialChange } from "../block3/commercial-changesets";
import { createWorldPlan } from "../block3/generated-business-economics";
import type { GeneratedWorldService } from "../../core/generated-world-service";
import { discover } from "./discovery";
import { bindReference, resolveOrdinal } from "./reference-bindings";

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
  const found = await discover(db, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    query,
    kind: string(values, "kind") === "need" ? "need" : "offering",
    explicitScope: values.scope,
    availability: { internal: true, web: Array.isArray(values.webResults) },
    hardConstraints: Array.isArray(values.hardConstraints) ? values.hardConstraints as never[] : [],
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
    positions.map((position) => resolveOrdinal(db, input.conversationId, position)),
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
  const resolution = await resolveOrdinal(db, input.conversationId, position);
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
    summary: "ثُبتت موافقتك على البصمة الحالية وأُنشئت نية دفع فقط؛ لم يحدث دفع.",
    data: { orderId: order.id, paymentIntentId: payment.intent.id, paymentStatus: payment.intent.status, effects: "none" },
    status: "completed",
  };
}

async function payTurn(
  db: NodePgDatabase<any>,
  input: { ownerId: string; conversationId: string; envelope: IntentEnvelope },
): Promise<ConversationCommerceResult> {
  const binding = await activeBinding(db, input.ownerId, input.conversationId, "current:payment");
  if (!binding || binding.targetKind !== "payment_intent") {
    return clarification("أي نية دفع تقصد؟ كلمة الدفع وحدها لا تمنح تفويضاً ولا توجد نية دفع في سياق هذه المحادثة.");
  }
  const [payment] = await db.select().from(paymentIntents).where(and(
    eq(paymentIntents.id, binding.targetId),
    eq(paymentIntents.ownerId, input.ownerId),
  )).limit(1);
  if (!payment?.orderId) return clarification("نية الدفع الحالية غير مرتبطة بطلب صالح.");
  const [order] = await db.select().from(commercialOrders).where(eq(commercialOrders.id, payment.orderId)).limit(1);
  const offeringId = order && string(object(order.terms), "offeringRef");
  const offering = offeringId ? await currentOffering(db, offeringId, input.ownerId) : null;
  const approved = object(payment.providerConstraints);
  if (
    !order ||
    !offering ||
    approved.approvedOrderFingerprint !== order.termsFingerprint ||
    approved.approvedOfferingFingerprint !== termsFingerprint(publicTerms(offering))
  ) {
    if (order && offering && termsFingerprint({ offeringRef: offering.id, offeringVersion: offering.version, ...publicTerms(offering) }) !== order.termsFingerprint) {
      await updateCommercialTerms(db, {
        id: order.id,
        terms: { offeringRef: offering.id, offeringVersion: offering.version, ...publicTerms(offering) },
        expectedVersion: order.termsVersion,
      });
    }
    return {
      kind: "structured_result",
      label: "Re-approval required",
      summary: "تغيرت الشروط بعد الموافقة. رُفض بدء الدفع ويجب مراجعة الشروط الحالية والموافقة عليها من جديد.",
      data: { orderId: order?.id ?? null, paymentIntentId: payment.id, effects: "none" },
      status: "reapproval_required",
    };
  }
  const values = input.envelope.intent?.inputs ?? {};
  const provider = string(values, "provider");
  const adapterEndpoint = string(values, "adapterEndpoint");
  if (!provider || !adapterEndpoint) {
    return clarification("نية الدفع محددة، لكن يلزم اختيار مزود دفع موثوق وطريقة دفع قبل فتح جلسة checkout.");
  }
  const checkout = await createFinancialCheckout(db, {
    intentId: payment.id,
    ownerId: input.ownerId,
    provider,
    adapterEndpoint,
  });
  return {
    kind: "structured_result",
    label: "Checkout ready",
    summary: "أُنشئت جلسة checkout مرتبطة بنية الدفع. فتحها لا يثبت نجاح الدفع.",
    data: { paymentIntentId: payment.id, sessionId: checkout.session.id, checkoutUrl: checkout.checkoutUrl, paymentTruth: "UNCHANGED" },
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
  const isDiscovery = hasLabel(input.envelope, /discovery|search|find|match/) || /(?:^|\s)(?:ابحث|فتش|جد)(?:\s|$)|\b(?:search|find|discover)\b/u.test(text);

  // Consequential intents are checked before discovery because classifier
  // labels may contain both "search" and the requested follow-up action.
  if (isPay) return payTurn(input.db, input);
  if (isApprove) return approveOrder(input.db, input);
  if (isCompare) return compareTurn(input.db, input);
  if (isSelect) return selectTurn(input.db, input);
  if (isPublish) return publishTurn(input.worlds, input);
  if (isWorldCommerce) return worldCommerceTurn(input.db, input.worlds, input);
  if (isDiscovery) return discoverTurn(input.db, input);
  return null;
}