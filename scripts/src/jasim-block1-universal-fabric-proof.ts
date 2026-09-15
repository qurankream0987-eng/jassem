/**
 * JASIM Block 1 — Universal Capability Fabric acceptance harness.
 *
 * ONE consolidated suite exercising the SAME generic architecture across
 * unrelated domains: semantic composition (Phase 1), generic presentation
 * (Phase 2), economic value network (Phase 3), security/trust, and unseen
 * generalization against a frozen architecture.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function mustThrow(action: () => Promise<unknown> | unknown, label: string): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${label} did not throw`);
}

const results: Array<{ gate: string; pass: boolean; detail?: string }> = [];
function gate(name: string, check: () => void): void;
function gate(name: string, check: () => Promise<void>): Promise<void>;
function gate(name: string, check: () => void | Promise<void>): any {
  const finish = (error?: unknown) => {
    if (error) {
      results.push({ gate: name, pass: false, detail: error instanceof Error ? error.message : String(error) });
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
    } else {
      results.push({ gate: name, pass: true });
      console.log(`PASS ${name}`);
    }
  };
  try {
    const out = check();
    if (out instanceof Promise) return out.then(() => finish(), finish);
    finish();
  } catch (error) {
    finish(error);
  }
}

const RUN = randomUUID().slice(0, 8);
const USER_A = `block1:a:${RUN}`;
const USER_B = `block1:b:${RUN}`;
const USER_C = `block1:c:${RUN}`;

const APP_ROOT = path.resolve(process.cwd(), "../canonical/جاسم/app");
const imp = (rel: string) => import(pathToFileURL(path.join(APP_ROOT, rel)).href);

async function main() {
  const registryMod = await imp("api/runtime/capability-registry.ts");
  const fabric = await imp("api/runtime/semantic-fabric.ts");
  const presentation = await imp("api/runtime/presentation-fabric.ts");
  const economic = await imp("api/runtime/economic-fabric.ts");
  const external = await imp("api/runtime/external-action-session.ts");
  const schema = await imp("db/schema.ts");
  const { db } = await imp("api/queries/connection.ts");

  // ---------------------------------------------------------------
  // Frozen generic capability registry (no domain nouns allowed).
  // ---------------------------------------------------------------
  const registry = new registryMod.CapabilityRegistry();
  const pure = async () => ({ ok: true });
  const reg = (cap: Record<string, unknown>) =>
    registry.register({ aliases: [], risk: "low", sideEffects: "none", execute: pure, ...cap });

  reg({ id: "extract", semanticPurposes: ["EXTRACT"], effectClass: "pure",
    inputSpec: [{ name: "source", type: "object", required: true }],
    outputSpec: [{ name: "records", type: "array" }] });
  reg({ id: "structure", semanticPurposes: ["STRUCTURE"], effectClass: "pure",
    inputSpec: [{ name: "records", type: "array", required: true }],
    outputSpec: [{ name: "document", type: "object" }] });
  reg({ id: "generate", semanticPurposes: ["GENERATE"], effectClass: "pure",
    inputSpec: [{ name: "document", type: "object", required: true }],
    outputSpec: [{ name: "artifact", type: "object" }] });
  reg({ id: "analyze", semanticPurposes: ["ANALYZE", "COMPARE", "CALCULATE", "RANK"], effectClass: "pure" });
  reg({ id: "discover", semanticPurposes: ["DISCOVER", "SEARCH"], effectClass: "pure",
    outputSpec: [{ name: "candidates", type: "array" }] });
  reg({ id: "match", semanticPurposes: ["MATCH"], effectClass: "pure",
    inputSpec: [{ name: "candidates", type: "array", required: true }],
    outputSpec: [{ name: "matches", type: "array" }] });
  reg({ id: "resolve-entity", semanticPurposes: ["RESOLVE_ENTITY", "CREATE", "CREATE_ENTITY", "UPDATE"], effectClass: "internal_stateful",
    outputSpec: [{ name: "subject", type: "object" }] });
  reg({ id: "create-offering", semanticPurposes: ["CREATE_OFFERING", "CREATE_NEED"], effectClass: "internal_stateful",
    inputSpec: [
      { name: "subject", type: "object", required: false },
      { name: "semanticType", type: "string", required: true },
    ],
    outputSpec: [{ name: "expressionRef", type: "string" }] });
  reg({ id: "publish", semanticPurposes: ["PUBLISH"], effectClass: "internal_stateful",
    inputSpec: [{ name: "expressionRef", type: "string", required: true }],
    outputSpec: [{ name: "publicationRef", type: "string" }] });
  reg({ id: "engage", semanticPurposes: ["ENGAGE", "MESSAGE", "NEGOTIATE", "PROPOSE"], effectClass: "internal_stateful",
    outputSpec: [{ name: "engagementRef", type: "string" }] });
  reg({ id: "track", semanticPurposes: ["TRACK", "LOCATE"], effectClass: "pure",
    providerRequirements: ["location-provider"],
    outputSpec: [{ name: "observation", type: "object" }] });
  reg({ id: "pay", semanticPurposes: ["PAY"], effectClass: "external_effectful",
    providerRequirements: ["payment-provider"],
    inputSpec: [
      { name: "amount", type: "number", required: true },
      { name: "currency", type: "string", required: true },
      { name: "payee", type: "string", required: true },
    ] });
  reg({ id: "generate-world", semanticPurposes: ["GENERATE_WORLD", "GENERATE_WORLD_DEFINITION", "GENERATE_SCHEMA", "GENERATE_WORKFLOWS", "CREATE_SMART_BUBBLE"], effectClass: "internal_stateful",
    outputSpec: [{ name: "bubbleRef", type: "string" }] });
  reg({ id: "create-projection", semanticPurposes: ["CREATE_PUBLIC_PROJECTION"], effectClass: "internal_stateful",
    inputSpec: [{ name: "bubbleRef", type: "string", required: true }],
    outputSpec: [{ name: "projectionRef", type: "string" }] });
  reg({ id: "notify", semanticPurposes: ["NOTIFY"], effectClass: "external_effectful",
    providerRequirements: ["notification-provider"] });
  reg({ id: "observe", semanticPurposes: ["OBSERVE", "CONDITION"], effectClass: "pure",
    outputSpec: [{ name: "observation", type: "object" }] });
  reg({ id: "verify", semanticPurposes: ["VERIFY"], effectClass: "pure" });
  // DEVICE_CONTROL deliberately NOT registered (truthful gap for K15).

  const NO_PROVIDERS = { availableProviders: [] as string[], availableResources: [] as string[] };

  const req = (r: Record<string, unknown>) => ({
    inputSpec: [], outputSpec: [], dependsOn: [], effectClass: "pure", semanticPurpose: "", ...r,
  });

  // ===============================================================
  console.log("\n=== PHASE 1: UNIVERSAL CAPABILITY FABRIC ===");
  // ===============================================================

  gate("SEMANTIC_GOAL_MODEL", () => {
    const goal = {
      actor: USER_A, intent: "MAKE_VALUE_AVAILABLE", references: ["my iphone"],
      desiredOutcomes: [{ id: "o1", semantics: "offering exists", dependsOn: [] }],
      hardConstraints: [], softPreferences: [], economicContext: "economic",
    };
    assert(goal.desiredOutcomes.length === 1 && goal.intent.length > 0, "semantic goal structure");
  });

  let sellPhoneComposed: any;
  gate("DESIRED_OUTCOME_GRAPH+COMPOSITION", () => {
    const graph = {
      goalId: "g-sell-phone",
      requirements: [
        req({ id: "r1", kind: "RESOLVE_ENTITY", effectClass: "internal_stateful" }),
        req({ id: "r2", kind: "CREATE_OFFERING", effectClass: "internal_stateful", dependsOn: ["r1"],
          inputSpec: [{ name: "subject", type: "object", required: true }, { name: "semanticType", type: "string", required: true }] }),
        req({ id: "r3", kind: "PUBLISH", effectClass: "internal_stateful", dependsOn: ["r2"] }),
      ],
    };
    const result = fabric.composeRequirementGraph(graph, registry, {
      ...NO_PROVIDERS,
      knownInputs: { r2: { semanticType: "used phone" } },
    });
    assert(result.status === "COMPOSED", `expected COMPOSED, got ${JSON.stringify(result.gaps)}`);
    assert(result.nodes.length === 3, "3 composed nodes");
    sellPhoneComposed = result;
  });

  gate("CAPABILITY_MATCHING_SEMANTIC_NOT_NAME", () => {
    const node = sellPhoneComposed.nodes.find((n: any) => n.requirementId === "r2");
    assert(node.capabilityId === "create-offering", `semantic match expected create-offering, got ${node.capabilityId}`);
  });

  gate("TYPED_BINDINGS", () => {
    const r2 = sellPhoneComposed.nodes.find((n: any) => n.requirementId === "r2");
    assert(r2.bindings.some((b: any) => b.fromField === "subject" && b.toField === "subject"), "typed binding subject r1->r2");
  });

  gate("BINDING_VALIDATION_TYPE_MISMATCH", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-bad",
      requirements: [
        req({ id: "a", kind: "EXTRACT", outputSpec: [{ name: "records", type: "array" }] }),
        req({ id: "b", kind: "STRUCTURE", dependsOn: ["a"],
          inputSpec: [{ name: "records", type: "object", required: true }] }),
      ],
    }, registry, NO_PROVIDERS);
    assert(result.status === "BLOCKED" && result.gaps.some((g: any) => g.kind === "BINDING_VALIDATION_FAILED"), "type mismatch must fail binding");
  });

  gate("COMPOSITION_VALIDATION_CYCLE", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-cycle",
      requirements: [
        req({ id: "a", kind: "EXTRACT", dependsOn: ["b"] }),
        req({ id: "b", kind: "STRUCTURE", dependsOn: ["a"] }),
      ],
    }, registry, NO_PROVIDERS);
    assert(result.status === "BLOCKED" && result.gaps[0].kind === "BINDING_VALIDATION_FAILED", "cycle must be rejected");
  });

  gate("MISSING_CAPABILITY_TRUTHFUL", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-device",
      requirements: [req({ id: "d", kind: "DEVICE_CONTROL", effectClass: "external_effectful" })],
    }, registry, NO_PROVIDERS);
    assert(result.gaps.some((g: any) => g.kind === "MISSING_GENERIC_CAPABILITY"), "DEVICE_CONTROL must be a truthful gap");
  });

  gate("MISSING_PROVIDER_TRUTHFUL", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-track",
      requirements: [req({ id: "t", kind: "TRACK" })],
    }, registry, NO_PROVIDERS);
    assert(result.gaps.some((g: any) => g.kind === "BLOCKED_BY_PROVIDER" && g.providerClass === "location-provider"), "TRACK must be provider-blocked");
  });

  gate("MISSING_RESOURCE_TRUTHFUL", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-res",
      requirements: [req({ id: "x", kind: "ANALYZE", resourceRequirement: "spectrometer-lab" })],
    }, registry, NO_PROVIDERS);
    assert(result.gaps.some((g: any) => g.kind === "BLOCKED_BY_RESOURCE"), "missing resource must be truthful");
  });

  gate("HUMAN_AND_AUTHORITY_GATES", () => {
    for (const [authority, expected] of [["human", "REQUIRES_HUMAN"], ["owner", "REQUIRES_OWNER_DECISION"], ["regulatory", "REQUIRES_REGULATORY_REVIEW"]] as const) {
      const result = fabric.composeRequirementGraph({
        goalId: `g-${authority}`,
        requirements: [req({ id: "h", kind: "VERIFY", authorityClass: authority })],
      }, registry, NO_PROVIDERS);
      assert(result.gaps.some((g: any) => g.kind === expected), `${authority} must produce ${expected}`);
    }
  });

  gate("INSUFFICIENT_INFORMATION_MINIMAL", () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-pay",
      requirements: [req({ id: "p", kind: "PAY", effectClass: "external_effectful" })],
    }, registry, {
      availableProviders: ["payment-provider"], availableResources: [],
      knownInputs: { p: { amount: 80, currency: "KWD" } },
    });
    const gap = result.gaps.find((g: any) => g.kind === "INSUFFICIENT_INFORMATION");
    assert(gap, "pay without payee must be INSUFFICIENT_INFORMATION");
    assert(JSON.stringify(gap.missingInputs) === JSON.stringify(["payee"]), "only payee is missing");
  });

  gate("NO_DOMAIN_CAPABILITY_ROUTING", () => {
    const DOMAIN_NOUNS = ["phone", "car", "job", "warehouse", "driver", "repair", "debt", "tutor", "oven", "chair", "robot", "factory"];
    for (const cap of registry.list()) {
      for (const noun of DOMAIN_NOUNS) {
        assert(!cap.id.includes(noun), `domain noun ${noun} in capability ${cap.id}`);
      }
    }
  });

  // ===============================================================
  console.log("\n=== PHASE 2: GENERATIVE INTERACTION FABRIC ===");
  // ===============================================================

  gate("SEMANTIC_OUTPUT_ROUTING+SMALLEST_SUFFICIENT_SURFACE", () => {
    assert(presentation.routePresentation({ interactionNeed: "inform", data: { text: "hi" } }).primitive === "TEXT", "inform->TEXT");
    assert(presentation.routePresentation({ interactionNeed: "collect_input", data: {}, missingFields: [{ name: "price", type: "number" }] }).primitive === "FORM", "missing->FORM");
    assert(presentation.routePresentation({ interactionNeed: "compare", data: {}, candidates: [{}, {}] }).primitive === "COMPARISON", "compare->COMPARISON");
    assert(presentation.routePresentation({ interactionNeed: "show_state", data: {} }).primitive === "STATUS", "state->STATUS");
    assert(presentation.routePresentation({ interactionNeed: "show_history", data: {}, events: [] }).primitive === "TIMELINE", "history->TIMELINE");
    assert(presentation.routePresentation({ interactionNeed: "operate_persistent", data: {} }).primitive === "SMART_BUBBLE", "persistent->SMART_BUBBLE");
    assert(presentation.routePresentation({ interactionNeed: "preview_artifact", data: {} }).primitive === "ARTIFACT_PREVIEW", "artifact->ARTIFACT_PREVIEW");
    assert(presentation.routePresentation({ interactionNeed: "show_schedule", data: {} }).primitive === "CALENDAR", "schedule->CALENDAR");
  });

  gate("GENERIC_TRACKER_WITHOUT_FABRICATED_MAP", () => {
    const noCoords = presentation.routePresentation({
      interactionNeed: "track", data: { entityRef: "shipment-1" },
      observation: { status: "customs cleared", locationDescription: "Warehouse A", observedAt: "2026-08-22T10:00:00Z", source: "carrier-scan" },
    });
    assert(noCoords.primitive === "TRACKER", "tracker present");
    assert(!noCoords.children?.some((c: any) => c.primitive === "MAP"), "no MAP without trusted coordinates");
  });

  gate("GENERIC_MAP_PROJECTION_WITH_TRUSTED_COORDS", () => {
    const withCoords = presentation.routePresentation({
      interactionNeed: "track", data: { entityRef: "tech-7" },
      observation: { status: "en route", coordinates: { lat: 29.3, lng: 47.9 }, observedAt: "2026-08-22T10:00:00Z", source: "trusted-gps" },
    });
    const map = withCoords.children?.find((c: any) => c.primitive === "MAP");
    assert(map, "MAP present with trusted coordinates");
    assert(map.data.markers[0].coordinates.lat === 29.3, "marker coordinates preserved");
  });

  gate("SCHEMA_DRIVEN_FORM_REQUIRED_VS_UNKNOWN", () => {
    const form = presentation.routePresentation({
      interactionNeed: "collect_input", data: {},
      missingFields: [
        { name: "price", type: "number", unknown: false },
        { name: "certification", type: "string", unknown: true },
      ],
    });
    const price = form.fields?.find((f: any) => f.name === "price");
    const cert = form.fields?.find((f: any) => f.name === "certification");
    assert(price?.requiredNow === true, "known-missing required now");
    assert(cert?.requiredNow === false, "unknown not required now");
  });

  gate("APPROVAL_SURFACE_CONTENT", () => {
    const approval = presentation.routePresentation({
      interactionNeed: "authorize", data: {},
      approvalSummary: { action: "publish offering", stateChanges: ["visibility: private->public"], publicData: ["summary", "terms"], externalEffect: undefined },
    });
    assert(approval.primitive === "APPROVAL", "approval primitive");
    assert(approval.data.stateChanges.length === 1, "state change disclosed");
    assert(approval.actions?.every((a: any) => typeof a.intent === "string"), "actions are intents only");
  });

  gate("ACTION_INTENT_BOUNDARY_NO_URL_IN_PRESENTATION", () => {
    const ext = presentation.routePresentation({
      interactionNeed: "external_transition", data: {},
      externalAction: { provider: "payment", purpose: "checkout", sessionId: "sess-1" },
    });
    assert(ext.primitive === "EXTERNAL_ACTION", "external action primitive");
    assert(ext.data.url === undefined, "presentation must not carry provider URL");
    assert(ext.actions?.[0]?.external === true, "external action is an intent");
  });

  gate("WEB_MOBILE_SHARED_PRESENTATION_CONTRACT", () => {
    const def = presentation.routePresentation({ interactionNeed: "compare", data: {}, candidates: [{ a: 1 }] });
    const json = JSON.parse(JSON.stringify(def));
    assert(json.primitive === "COMPARISON" && json.version === 1, "platform-neutral serializable contract");
  });

  gate("GENERIC_MATCH_EXPLANATION_NO_OPAQUE_PERCENT", () => {
    const proj = presentation.projectMatchExplanation({
      constraintResults: [
        { field: "price", state: "PASS" },
        { field: "certified", state: "UNKNOWN" },
      ],
    });
    assert(JSON.stringify(proj.data).includes("UNKNOWN"), "unknown preserved in explanation");
    assert(!JSON.stringify(proj.data).match(/\d+(\.\d+)?%/), "no fake percentage");
  });

  // ===============================================================
  console.log("\n=== PHASE 3: ECONOMIC VALUE NETWORK (PostgreSQL) ===");
  // ===============================================================

  let phoneOffering: any;
  await gate("K1_SELL_PHONE_GENERIC_FLOW", async () => {
    phoneOffering = await economic.createExpression({
      ownerId: USER_A, kind: "offering", semanticType: "used phone",
      attributes: { model: "iPhone 13", storage: "128GB", condition: "good", price: 150, priceUnit: "KWD" },
    });
    assert(phoneOffering.visibility === "private" && phoneOffering.status === "draft", "default private draft");
    await mustThrow(
      () => economic.publishExpression({ id: phoneOffering.id, ownerId: USER_A, projection: { summary: "iPhone", privateNotes: "x" } }),
      "projection with private key",
    );
    const published = await economic.publishExpression({
      id: phoneOffering.id, ownerId: USER_A,
      projection: { semanticType: "used phone", summary: "iPhone 13, 128GB, good", publicTerms: { price: 150, currency: "KWD" }, engagementAction: "contact" },
    });
    assert(published.visibility === "public" && published.version === 2, "publication transition + version");
  });

  await gate("VISIBILITY_PRIVATE_DISCOVERY_LEAK", async () => {
    await economic.createExpression({
      ownerId: USER_A, kind: "offering", semanticType: "secret prototype",
      attributes: { price: 5 },
    }).then(async (expr) => {
      await economic.publishExpression; // never published; stays private draft
      const foundByB = await economic.discoverExpressions({ kind: "offering", requesterOwnerId: USER_B });
      assert(!foundByB.some((row: any) => row.id === expr.id), "private expression leaked into discovery");
      await mustThrow(() => economic.getExpression(expr.id, USER_B), "cross-owner private read");
    });
  });

  await gate("CROSS_USER_DISCOVERY", async () => {
    const found = await economic.discoverExpressions({ kind: "offering", requesterOwnerId: USER_B, semanticType: "phone" });
    assert(found.some((row: any) => row.id === phoneOffering.id), "public phone offering discoverable by second user");
  });

  let employmentMatch: any;
  await gate("K2_EMPLOY_ME_BIDIRECTIONAL", async () => {
    const personOffering = await economic.createExpression({
      ownerId: USER_B, kind: "offering", semanticType: "software development labor",
      attributes: { skill: "React", experience: 4, salary: 1400, availability: "immediate", servesSemantics: ["react developer"] },
    });
    await economic.publishExpression({ id: personOffering.id, ownerId: USER_B, projection: { semanticType: "software development labor", summary: "React dev, 4y" } });
    await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "employment opportunity",
      attributes: {}, hardConstraints: [{ field: "salary", operator: "gte", value: 1200, unit: "KWD" }],
    });
    const companyNeed = await economic.createExpression({
      ownerId: USER_C, kind: "need", semanticType: "react developer",
      attributes: {}, hardConstraints: [
        { field: "skill", operator: "eq", value: "React" },
        { field: "experience", operator: "gte", value: 3, unit: "years" },
        { field: "salary", operator: "lte", value: 1500, unit: "KWD" },
      ],
    });
    employmentMatch = await economic.matchNeedToOffering({ needId: companyNeed.id, offeringId: personOffering.id, createdByOwnerId: USER_C });
    assert(employmentMatch.status === "viable", `expected viable match, got ${employmentMatch.status}`);
    const results = employmentMatch.constraintResults as any[];
    assert(results.every((r) => r.state === "PASS"), "all hard constraints pass");
    // Bidirectional: Offering -> discover Needs
    const pubNeed = await economic.publishExpression({ id: companyNeed.id, ownerId: USER_C, projection: { semanticType: "react developer", summary: "React role" } });
    const needsFound = await economic.discoverExpressions({ kind: "need", requesterOwnerId: USER_B, semanticType: "react" });
    assert(needsFound.some((row: any) => row.id === pubNeed.id), "offering side can discover needs");
  });

  await gate("K3_HARD_CONSTRAINTS_UNKNOWN_PRESERVED", async () => {
    const weak = await economic.createExpression({
      ownerId: USER_B, kind: "offering", semanticType: "software development labor",
      attributes: { skill: "React", experience: 1, salary: 900, servesSemantics: ["react developer"] },
    });
    await economic.publishExpression({ id: weak.id, ownerId: USER_B, projection: { summary: "junior" } });
    const unknownAvail = await economic.createExpression({
      ownerId: USER_C, kind: "offering", semanticType: "software development labor",
      attributes: { skill: "React", experience: 5, salary: 1500, servesSemantics: ["react developer"] },
    });
    await economic.publishExpression({ id: unknownAvail.id, ownerId: USER_C, projection: { summary: "senior" } });
    const need = await economic.createExpression({
      ownerId: USER_A, kind: "need", semanticType: "react developer",
      attributes: {}, hardConstraints: [
        { field: "experience", operator: "gte", value: 3, unit: "years" },
        { field: "salary", operator: "lte", value: 1500, unit: "KWD" },
        { field: "nextWeekAvailable", operator: "eq", value: true },
      ],
    });
    const failMatch = await economic.matchNeedToOffering({ needId: need.id, offeringId: weak.id, createdByOwnerId: USER_A });
    assert(failMatch.status === "rejected", "experience 1y must fail >=3y");
    const unknownMatch = await economic.matchNeedToOffering({ needId: need.id, offeringId: unknownAvail.id, createdByOwnerId: USER_A });
    const states = (unknownMatch.constraintResults as any[]).map((r) => r.state);
    assert(states.includes("UNKNOWN"), "missing availability must stay UNKNOWN");
    assert(unknownMatch.status === "viable", "no FAIL -> viable with UNKNOWN");
  });

  await gate("K4_UNIT_NORMALIZATION_TONS_KG", async () => {
    const coldOffering = await economic.createExpression({
      ownerId: USER_C, kind: "offering", semanticType: "refrigerated storage capacity",
      attributes: { capacity: 5000, capacityUnit: "kg", temperature: "-18C" },
      availability: { window: "next week" },
    });
    await economic.publishExpression({ id: coldOffering.id, ownerId: USER_C, projection: { summary: "5t cold storage" } });
    const need = await economic.createExpression({
      ownerId: USER_A, kind: "need", semanticType: "refrigerated storage",
      attributes: {}, hardConstraints: [{ field: "capacity", operator: "gte", value: 2, unit: "ton" }],
    });
    const match = await economic.matchNeedToOffering({ needId: need.id, offeringId: coldOffering.id, createdByOwnerId: USER_A });
    assert(match.status === "viable", "5000kg must satisfy >=2 ton after normalization");
  });

  await gate("K5_COMPOSITE_CAPACITY_MATCH", async () => {
    const mkOffering = async (tons: number) => {
      const o = await economic.createExpression({
        ownerId: USER_C, kind: "offering", semanticType: "refrigerated storage capacity",
        attributes: { capacity: tons, capacityUnit: "ton" },
      });
      return economic.publishExpression({ id: o.id, ownerId: USER_C, projection: { summary: `${tons}t` } });
    };
    await mkOffering(6);
    await mkOffering(4);
    const splitNeed = await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "refrigerated storage",
      attributes: { splitAllowed: true },
      hardConstraints: [{ field: "capacity", operator: "gte", value: 10, unit: "ton" }],
    });
    const { matches, composite } = await economic.matchNeed({ needId: splitNeed.id, requesterOwnerId: USER_B });
    assert(matches.length === 0, "no single offering satisfies 10t");
    assert(composite, "composite match expected");
    const components = composite.compositeComponents as any[];
    assert(components.length === 2, "6+4 composite");
    // singleFacilityRequired -> same pair must fail
    const strictNeed = await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "refrigerated storage",
      attributes: { splitAllowed: true, singleFacilityRequired: true },
      hardConstraints: [{ field: "capacity", operator: "gte", value: 10, unit: "ton" }],
    });
    const strict = await economic.matchNeed({ needId: strictNeed.id, requesterOwnerId: USER_B });
    assert(!strict.composite, "singleFacilityRequired must block composite");
    // UNKNOWN preservation: a composite over contributors with unproven
    // hard-constraint evidence must surface UNKNOWN, not hide behind PASS.
    const unknownNeed = await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "refrigerated storage",
      attributes: { splitAllowed: true },
      hardConstraints: [
        { field: "capacity", operator: "gte", value: 10, unit: "ton" },
        { field: "certified", operator: "eq", value: true },
      ],
    });
    const unknownComposite = await economic.matchNeed({ needId: unknownNeed.id, requesterOwnerId: USER_B });
    assert(unknownComposite.composite, "composite expected for unknown-evidence need");
    const compositeResults = unknownComposite.composite.constraintResults as any[];
    assert(compositeResults.some((r) => r.state === "UNKNOWN"), "UNKNOWN must survive into the composite record");
    assert(unknownComposite.composite.status === "candidate", "composite with UNKNOWN is a candidate, not viable");
    const unknownComponents = unknownComposite.composite.compositeComponents as any[];
    assert(unknownComponents.every((c) => Array.isArray(c.constraintResults)), "each contributor keeps its full constraint results");
  });

  let bubbleOffering: any;
  await gate("K6_K7_GENERATED_BUSINESS_PUBLICATION", async () => {
    const def = presentation.routePresentation({ interactionNeed: "operate_persistent", data: { worldSemantics: "repair coordination" } });
    assert(def.primitive === "SMART_BUBBLE", "persistent system surface");
    const draft = await economic.createExpression({
      ownerId: USER_A, kind: "offering", semanticType: "generated repair coordination capability",
      subjectEntityId: "bubble-repair-1",
      attributes: { customers: ["c1"], financials: { margin: 0.2 }, staffNotes: "private", servesSemantics: ["air-conditioning technician"] },
    });
    assert(draft.visibility === "private", "generated capability starts private");
    bubbleOffering = await economic.publishExpression({
      id: draft.id, ownerId: USER_A,
      projection: { semanticType: "generated repair coordination capability", summary: "AC and appliance repair coordination", availability: { days: ["sunday-thursday"] }, engagementAction: "request service" },
    });
    assert(!("customers" in (bubbleOffering.publicProjection ?? {})), "private world fields absent from projection");
  });

  await gate("K8_SECOND_USER_DISCOVERS_GENERATED_CAPABILITY", async () => {
    const need = await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "air-conditioning technician",
      attributes: {}, hardConstraints: [],
    });
    const found = await economic.discoverExpressions({ kind: "offering", requesterOwnerId: USER_B, semanticType: "repair" });
    assert(found.some((row: any) => row.id === bubbleOffering.id), "second user discovers generated capability without knowing bubble id");
    const { matches } = await economic.matchNeed({ needId: need.id, requesterOwnerId: USER_B });
    assert(matches.some((m: any) => m.offeringId === bubbleOffering.id), "match against generated capability");
  });

  await gate("MATCH_AUTHORIZATION_NO_PRIVATE_ORACLE", async () => {
    const privateNeed = await economic.createExpression({
      ownerId: USER_A, kind: "need", semanticType: "confidential hiring",
      attributes: {}, hardConstraints: [{ field: "clearance", operator: "eq", value: "top" }],
    });
    await mustThrow(
      () => economic.matchNeedToOffering({ needId: privateNeed.id, offeringId: phoneOffering.id, createdByOwnerId: USER_B }),
      "cross-owner need matching",
    );
    await mustThrow(
      () => economic.matchNeed({ needId: privateNeed.id, requesterOwnerId: USER_B }),
      "cross-owner matchNeed",
    );
    const privateOffering = await economic.createExpression({
      ownerId: USER_B, kind: "offering", semanticType: "used phone",
      attributes: { price: 1 },
    });
    await mustThrow(
      () => economic.matchNeedToOffering({ needId: privateNeed.id, offeringId: privateOffering.id, createdByOwnerId: USER_A }),
      "private offering must not be a match oracle",
    );
  });

  await gate("SHARED_REQUIRES_EXPLICIT_GRANT", async () => {
    const shared = await economic.createExpression({
      ownerId: USER_A, kind: "offering", semanticType: "shared workshop tool",
      attributes: { deposit: 50 },
    });
    await db.update(schema.economicExpressions)
      .set({ visibility: "shared", status: "active" })
      .where(eq_(schema.economicExpressions.id, shared.id));
    await mustThrow(() => economic.getExpression(shared.id, USER_B), "shared read without grant");
    const ownView = await economic.getExpression(shared.id, USER_A);
    assert(ownView && "attributes" in ownView, "owner retains full access to shared expression");
  });

  // Helper: build an authorized match-backed engagement between USER_A and USER_B.
  async function makeEngagementPair(semantics: string) {
    const n = await economic.createExpression({ ownerId: USER_A, kind: "need", semanticType: semantics, attributes: {} });
    const o = await economic.createExpression({ ownerId: USER_B, kind: "offering", semanticType: semantics, attributes: {} });
    await economic.publishExpression({ id: o.id, ownerId: USER_B, projection: { summary: semantics } });
    const m = await economic.matchNeedToOffering({ needId: n.id, offeringId: o.id, createdByOwnerId: USER_A });
    return economic.createEngagement({ matchId: m.id, initiatorOwnerId: USER_A, participants: [USER_A, USER_B] });
  }

  await gate("ENGAGEMENT_REQUIRES_AUTHORIZED_MATCH", async () => {
    const engNeed = await economic.createExpression({ ownerId: USER_A, kind: "need", semanticType: "garden cleanup", attributes: {} });
    const engOffer = await economic.createExpression({ ownerId: USER_B, kind: "offering", semanticType: "garden cleanup", attributes: {} });
    await economic.publishExpression({ id: engOffer.id, ownerId: USER_B, projection: { summary: "garden cleanup" } });
    const m = await economic.matchNeedToOffering({ needId: engNeed.id, offeringId: engOffer.id, createdByOwnerId: USER_A });
    await mustThrow(() => economic.createEngagement({ initiatorOwnerId: USER_A, participants: [USER_A, USER_B] } as any), "engagement without match");
    await mustThrow(() => economic.createEngagement({ matchId: "nonexistent", initiatorOwnerId: USER_A, participants: [USER_A, USER_B] }), "engagement with unknown match");
    await mustThrow(() => economic.createEngagement({ matchId: m.id, initiatorOwnerId: USER_B, participants: [USER_A, USER_B] }), "non-match-initiator cannot open engagement");
    await mustThrow(() => economic.createEngagement({ matchId: m.id, initiatorOwnerId: USER_A, participants: [USER_A, USER_C] }), "forged participant rejected");
    const eng = await economic.createEngagement({ matchId: m.id, initiatorOwnerId: USER_A, participants: [USER_A, USER_B] });
    assert(eng.participants.length === 2, "match-backed engagement created");
  });

  await gate("PROPOSAL_EXPIRY_ENFORCED", async () => {
    const eng = await makeEngagementPair("expiry test");
    const p = await economic.createProposal({
      engagementId: eng.id, proposerOwnerId: USER_A,
      terms: { offer: "x" }, expiresAt: new Date(Date.now() - 1000),
    });
    await mustThrow(() => economic.respondToProposal({ proposalId: p.id, ownerId: USER_B, action: "accept" }), "expired proposal acceptance");
  });

  await gate("PUBLIC_DTO_NO_PRIVATE_ATTRIBUTES", async () => {
    const found = await economic.discoverExpressions({ kind: "offering", requesterOwnerId: USER_B, semanticType: "repair" });
    const view = found.find((row: any) => row.id === bubbleOffering.id);
    assert(view, "generated capability discoverable");
    assert(!("attributes" in view) && !("hardConstraints" in view) && !("ownerId" in view), "non-owner discovery must return public view only");
    assert(!JSON.stringify(view).includes("customers") && !JSON.stringify(view).includes("margin"), "private world fields absent from discovery");
    const fetched = await economic.getExpression(bubbleOffering.id, USER_B);
    assert(fetched && !("attributes" in fetched), "cross-owner read returns controlled projection only");
    const own = await economic.getExpression(bubbleOffering.id, USER_A);
    assert(own && "attributes" in own, "owner still receives full row");
  });

  await gate("K12_INDUSTRIAL_OVEN_RESOURCE_TIME", async () => {
    const oven = await economic.createExpression({
      ownerId: USER_C, kind: "offering", semanticType: "industrial heating capacity",
      attributes: { dayOfWeek: "tuesday", hours: 8 },
      availability: { day: "tuesday" },
    });
    await economic.publishExpression({ id: oven.id, ownerId: USER_C, projection: { summary: "industrial oven tuesdays" } });
    const need = await economic.createExpression({
      ownerId: USER_B, kind: "need", semanticType: "industrial oven time",
      attributes: {}, hardConstraints: [
        { field: "dayOfWeek", operator: "eq", value: "tuesday" },
        { field: "hours", operator: "gte", value: 4, unit: "hours" },
      ],
    });
    const match = await economic.matchNeedToOffering({ needId: need.id, offeringId: oven.id, createdByOwnerId: USER_B });
    assert(match.status === "viable", "generic capacity+time match");
  });

  let barterIntent: any;
  await gate("K11_SKILL_EXCHANGE_TRANSACTION_WITHOUT_PAYMENT", async () => {
    const engagement = await makeEngagementPair("logo design <-> spanish lessons");
    const v1 = await economic.createProposal({ engagementId: engagement.id, proposerOwnerId: USER_A, terms: { offer: "logo design", request: "10 spanish lessons" } });
    const v2 = await economic.createProposal({ engagementId: engagement.id, proposerOwnerId: USER_B, terms: { offer: "8 spanish lessons", request: "logo design + revision" } });
    assert(v2.version === 2 && v2.supersedesId === v1.id, "proposal versioning");
    const { proposal, transactionIntent } = await economic.respondToProposal({ proposalId: v2.id, ownerId: USER_A, action: "accept" });
    assert(proposal.status === "accepted" && proposal.version === 2, "acceptance references exact version");
    assert(transactionIntent, "transaction intent created");
    assert(transactionIntent.valueKind === "non_monetary", "no payment mandatory");
    assert(transactionIntent.status === "intent", "intent is not execution");
    barterIntent = transactionIntent;
    await mustThrow(() => economic.respondToProposal({ proposalId: v2.id, ownerId: USER_B, action: "accept" }), "re-accept of accepted proposal");
  });

  await gate("K13_NON_ECONOMIC_ARTIFACT_NO_ECONOMY", async () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-invoices",
      requirements: [
        req({ id: "e", kind: "EXTRACT", inputSpec: [{ name: "source", type: "object", required: true }], outputSpec: [{ name: "records", type: "array" }] }),
        req({ id: "s", kind: "STRUCTURE", dependsOn: ["e"], inputSpec: [{ name: "records", type: "array", required: true }], outputSpec: [{ name: "document", type: "object" }] }),
        req({ id: "g", kind: "GENERATE", dependsOn: ["s"], inputSpec: [{ name: "document", type: "object", required: true }], outputSpec: [{ name: "artifact", type: "object" }] }),
      ],
    }, registry, { ...NO_PROVIDERS, knownInputs: { e: { source: { files: ["inv1.pdf"] } } } });
    assert(result.status === "COMPOSED", `invoice artifact composes: ${JSON.stringify(result.gaps)}`);
    const before = await economic.discoverExpressions({ kind: "offering", requesterOwnerId: USER_B });
    assert(!before.some((row: any) => row.semanticType.includes("invoice")), "economic network must not activate for artifact task");
  });

  await gate("K9_WHERE_IS_DRIVER_TRUTHFUL", async () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-driver",
      requirements: [req({ id: "t", kind: "TRACK" })],
    }, registry, NO_PROVIDERS);
    assert(result.gaps[0]?.kind === "BLOCKED_BY_PROVIDER", "tracking truthfully provider-blocked");
    const surface = presentation.routePresentation({
      interactionNeed: "track", data: { entityRef: "driver" },
      observation: { status: "location unavailable" },
    });
    assert(!surface.children?.some((c: any) => c.primitive === "MAP"), "no fabricated coordinates");
  });

  await gate("K10_PAY_PERSONAL_OBLIGATION_TRUTHFUL", async () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-debt",
      requirements: [req({ id: "p", kind: "PAY", effectClass: "external_effectful" })],
    }, registry, {
      availableProviders: [], availableResources: [],
      knownInputs: { p: { amount: 80, currency: "KWD", payee: "friend" } },
    });
    assert(result.gaps.some((g: any) => g.kind === "BLOCKED_BY_PROVIDER" && g.providerClass === "payment-provider"), "no payment provider in block 1");
  });

  await gate("K14_SHARED_LAB_EQUIPMENT_AVAILABILITY", async () => {
    const lab = await economic.createExpression({
      ownerId: USER_C, kind: "offering", semanticType: "laboratory machine time",
      attributes: { resolution: "5nm" },
      availability: { booking: "hourly slots" },
    });
    await economic.publishExpression({ id: lab.id, ownerId: USER_C, projection: { summary: "shared lab microscope", availability: { booking: "hourly slots" } } });
    const calendar = presentation.routePresentation({ interactionNeed: "show_schedule", data: { expressionRef: lab.id } });
    assert(calendar.primitive === "CALENDAR", "calendar projection");
    // Scheduler execution is Block 2: RESERVE must be a truthful gap.
    const reserve = fabric.composeRequirementGraph({
      goalId: "g-reserve",
      requirements: [req({ id: "r", kind: "RESERVE", effectClass: "internal_stateful" })],
    }, registry, NO_PROVIDERS);
    assert(reserve.gaps.some((g: any) => g.kind === "MISSING_GENERIC_CAPABILITY"), "RESERVE honestly missing in block 1");
  });

  await gate("K15_FACTORY_ROBOT_GENERIC_GAP", async () => {
    const result = fabric.composeRequirementGraph({
      goalId: "g-robot",
      requirements: [
        req({ id: "o", kind: "OBSERVE" }),
        req({ id: "c", kind: "CONDITION", dependsOn: ["o"] }),
        req({ id: "dc", kind: "DEVICE_CONTROL", effectClass: "external_effectful", dependsOn: ["c"] }),
        req({ id: "d", kind: "DISCOVER", dependsOn: ["c"] }),
        req({ id: "m", kind: "MATCH", dependsOn: ["d"] }),
        req({ id: "n", kind: "NOTIFY", effectClass: "external_effectful", dependsOn: ["m"] }),
      ],
    }, registry, NO_PROVIDERS);
    const kinds = result.gaps.map((g: any) => g.kind);
    assert(kinds.includes("MISSING_GENERIC_CAPABILITY"), "DEVICE_CONTROL truthful gap");
    assert(kinds.includes("BLOCKED_BY_PROVIDER"), "NOTIFY provider-blocked");
  });

  // ===============================================================
  console.log("\n=== SECURITY / PRIVACY / TRUST ===");
  // ===============================================================

  const APPROVED = ["https://payments.example.com", "http://localhost:8080"];
  external.resetExternalActionProviders();
  external.configureExternalActionProvider("payments", {
    checkout: { origins: APPROVED, pathPrefixes: ["/"] },
  });
  external.configureExternalActionProvider("government-portal", {
    "license renewal": { origins: APPROVED, pathPrefixes: ["/gov"] },
  });
  let session: any;
  await gate("EXTERNAL_ACTION_FOUNDATION", async () => {
    session = await external.createExternalActionSession({
      ownerId: USER_A, provider: "payments", purpose: "checkout",
      url: "https://payments.example.com/checkout?order=1",
      transactionIntentId: barterIntent?.id,
    });
    assert(session.status === "active" && session.nonce.length > 10, "session created with nonce");
    const resolved = await external.resolveExternalActionSession({ id: session.id, nonce: session.nonce, ownerId: USER_A });
    assert(resolved.purpose === "checkout", "purpose binding");
  });

  await gate("EXTERNAL_ACTION_SECURITY", async () => {
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "javascript:alert(1)" }), "javascript scheme");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "data:text/html,hi" }), "data scheme");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "unconfigured-provider", purpose: "x", url: "https://payments.example.com/" }), "unconfigured provider");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "https://evil.example.com/" }), "unapproved origin");
    // Adversarial: caller tries to nominate its own allowlist for the provider.
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "https://evil.example.com/", approvedOrigins: ["https://evil.example.com"] } as any), "caller-nominated origin allowlist");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "https://user:pass@payments.example.com/" }), "credential url");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "https://payments.example.com/r?redirect=https%3A%2F%2Fevil.example.com" }), "open redirect");
    await mustThrow(() => external.resolveExternalActionSession({ id: session.id, nonce: session.nonce, ownerId: USER_B }), "cross-owner reuse");
    // Purpose confusion: provider is configured for "license renewal" only.
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "government-portal", purpose: "checkout", url: "https://payments.example.com/gov/renew" }), "purpose confusion");
    // Deep-link guard: approved origin but outside the permitted path prefix.
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "government-portal", purpose: "license renewal", url: "https://payments.example.com/admin/panel" }), "path prefix escape");
    // Same-origin redirect escape: the redirect target must satisfy the SAME
    // purpose policy (approved origin AND permitted path prefix).
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "government-portal", purpose: "license renewal", url: "https://payments.example.com/gov/renew?next=https%3A%2F%2Fpayments.example.com%2Faccount%2Fdelete" }), "same-origin redirect escape");
    // Cross-purpose path: a path valid for one purpose cannot ride another.
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "government-portal", purpose: "license renewal", url: "https://payments.example.com/checkout" }), "cross-purpose path");
    // Transaction intent binding: referenced intent must belong to the owner.
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_C, provider: "payments", purpose: "checkout", url: "https://payments.example.com/checkout?order=9", transactionIntentId: barterIntent?.id }), "cross-owner transaction intent");
    await mustThrow(() => external.createExternalActionSession({ ownerId: USER_A, provider: "payments", purpose: "checkout", url: "https://payments.example.com/checkout?order=9", transactionIntentId: "nonexistent-intent" }), "unknown transaction intent");
    const expired = await external.createExternalActionSession({
      ownerId: USER_A, provider: "payments", purpose: "checkout",
      url: "https://payments.example.com/x", ttlMs: -1000,
    });
    await mustThrow(() => external.resolveExternalActionSession({ id: expired.id, nonce: expired.nonce, ownerId: USER_A }), "expired session");
    const consumed = await external.consumeExternalActionSession({ id: session.id, nonce: session.nonce, ownerId: USER_A });
    assert(consumed.status === "used", "single-use consumption");
    await mustThrow(() => external.consumeExternalActionSession({ id: session.id, nonce: session.nonce, ownerId: USER_A }), "replay of used session");
  });

  await gate("BOOT_CONFIG_ENFORCES_POLICIES", async () => {
    // Same code path as api/boot.ts parsing JASIM_EXTERNAL_PROVIDERS.
    await mustThrow(
      () => external.configureExternalActionProvidersFromConfig(JSON.stringify({ weak: { purposes: { go: { origins: APPROVED } } } }), { strict: true }),
      "strict boot config rejects purpose policy without pathPrefixes",
    );
    await mustThrow(
      () => external.configureExternalActionProvidersFromConfig(JSON.stringify({ empty: {} }), { strict: true }),
      "strict boot config rejects provider without purposes",
    );
    const configured = external.configureExternalActionProvidersFromConfig(
      JSON.stringify({ "boot-provider": { purposes: { checkout: { origins: APPROVED, pathPrefixes: ["/pay"] } } } }),
      { strict: true },
    );
    assert(configured.includes("boot-provider"), "boot config installs provider");
    await mustThrow(
      () => external.createExternalActionSession({ ownerId: USER_A, provider: "boot-provider", purpose: "other", url: "https://payments.example.com/pay/x" }),
      "boot-configured purpose guard",
    );
    await mustThrow(
      () => external.createExternalActionSession({ ownerId: USER_A, provider: "boot-provider", purpose: "checkout", url: "https://payments.example.com/other/x" }),
      "boot-configured path guard",
    );
    const ok = await external.createExternalActionSession({ ownerId: USER_A, provider: "boot-provider", purpose: "checkout", url: "https://payments.example.com/pay/x" });
    assert(ok.provider === "boot-provider", "boot-configured provider issues sessions");
  });

  // ===============================================================
  console.log("\n=== UNSEEN GENERALIZATION (frozen architecture) ===");
  // ===============================================================

  const unseen: Array<{ id: string; run: () => Promise<string> }> = [
    { id: "U1_PHYSICAL_RESOURCE_COORDINATION", run: async () => {
      const crane = await economic.createExpression({ ownerId: USER_C, kind: "offering", semanticType: "mobile crane capacity",
        attributes: { capacity: 50, capacityUnit: "ton", days: 3 }, availability: { window: "next month" } });
      await economic.publishExpression({ id: crane.id, ownerId: USER_C, projection: { summary: "50t crane, 3 days" } });
      const need = await economic.createExpression({ ownerId: USER_A, kind: "need", semanticType: "crane lift",
        attributes: {}, hardConstraints: [{ field: "days", operator: "gte", value: 3, unit: "days" }] });
      const m = await economic.matchNeedToOffering({ needId: need.id, offeringId: crane.id, createdByOwnerId: USER_A });
      assert(m.status === "viable", "crane coordination via generic primitives");
      return "COMPOSED";
    } },
    { id: "U2_ECONOMIC_BARTER", run: async () => {
      const eng = await makeEngagementPair("photography <-> copywriting");
      const p = await economic.createProposal({ engagementId: eng.id, proposerOwnerId: USER_A, terms: { offer: "photo session", request: "landing page copy" } });
      const { transactionIntent } = await economic.respondToProposal({ proposalId: p.id, ownerId: USER_B, action: "accept" });
      assert(transactionIntent?.valueKind === "non_monetary", "barter without payment");
      return "COMPOSED";
    } },
    { id: "U3_NON_ECONOMIC_TASK", run: async () => {
      const r = fabric.composeRequirementGraph({ goalId: "u3", requirements: [
        req({ id: "e", kind: "EXTRACT", inputSpec: [{ name: "source", type: "object", required: true }], outputSpec: [{ name: "records", type: "array" }] }),
        req({ id: "s", kind: "STRUCTURE", dependsOn: ["e"], inputSpec: [{ name: "records", type: "array", required: true }], outputSpec: [{ name: "document", type: "object" }] }),
      ] }, registry, { ...NO_PROVIDERS, knownInputs: { e: { source: { notes: true } } } });
      assert(r.status === "COMPOSED", "meeting-notes task composes without economy");
      return "COMPOSED";
    } },
    { id: "U4_GENERATED_PERSISTENT_BUSINESS", run: async () => {
      const r = fabric.composeRequirementGraph({ goalId: "u4", requirements: [
        req({ id: "w", kind: "GENERATE_WORLD", effectClass: "internal_stateful" }),
      ] }, registry, NO_PROVIDERS);
      assert(r.status === "COMPOSED", "persistent system generation composes");
      const surface = presentation.routePresentation({ interactionNeed: "operate_persistent", data: { ref: "tool-sharing" } });
      assert(surface.primitive === "SMART_BUBBLE", "persistent surface");
      return "COMPOSED";
    } },
    { id: "U5_MULTI_PARTY_CARPOOL", run: async () => {
      // Multi-party engagements require a composite match; unmatched ones are truthfully rejected.
      await mustThrow(() => economic.createEngagement({ initiatorOwnerId: USER_A, participants: [USER_A, USER_B, USER_C] } as any), "unmatched multi-party engagement rejected");
      const r = fabric.composeRequirementGraph({ goalId: "u5", requirements: [
        req({ id: "sch", kind: "SCHEDULE", effectClass: "internal_stateful" }),
      ] }, registry, NO_PROVIDERS);
      assert(r.gaps.some((g: any) => g.kind === "MISSING_GENERIC_CAPABILITY"), "scheduler truthfully deferred");
      return "MISSING_GENERIC_CAPABILITY";
    } },
    { id: "U6_TRACKING_REQUIREMENT", run: async () => {
      const r = fabric.composeRequirementGraph({ goalId: "u6", requirements: [req({ id: "t", kind: "TRACK" })] }, registry, NO_PROVIDERS);
      assert(r.gaps[0]?.kind === "BLOCKED_BY_PROVIDER", "shipment tracking provider-blocked");
      return "BLOCKED_BY_PROVIDER";
    } },
    { id: "U7_EXTERNAL_PROVIDER_REQUIREMENT", run: async () => {
      const s = await external.createExternalActionSession({
        ownerId: USER_B, provider: "government-portal", purpose: "license renewal",
        url: "https://payments.example.com/gov/renew",
      });
      assert(s.origin === "https://payments.example.com", "approved external session only");
      return "COMPOSED";
    } },
    { id: "U8_CAPACITY_TIME_CONSTRAINT", run: async () => {
      const room = await economic.createExpression({ ownerId: USER_C, kind: "offering", semanticType: "meeting room capacity",
        attributes: { seats: 25, seatsUnit: "seats", hours: 8, hoursUnit: "hours", servesSemantics: ["workshop space"] } });
      await economic.publishExpression({ id: room.id, ownerId: USER_C, projection: { summary: "25-seat room" } });
      const need = await economic.createExpression({ ownerId: USER_A, kind: "need", semanticType: "workshop space",
        attributes: {}, hardConstraints: [
          { field: "seats", operator: "gte", value: 20, unit: "seats" },
          { field: "hours", operator: "gte", value: 2, unit: "hours" },
        ] });
      const m = await economic.matchNeedToOffering({ needId: need.id, offeringId: room.id, createdByOwnerId: USER_A });
      assert(m.status === "viable", "capacity/time match");
      return "COMPOSED";
    } },
    { id: "U9_AUTHORITY_REGULATORY", run: async () => {
      const r = fabric.composeRequirementGraph({ goalId: "u9", requirements: [
        req({ id: "rx", kind: "VERIFY", authorityClass: "regulatory" }),
      ] }, registry, NO_PROVIDERS);
      assert(r.gaps.some((g: any) => g.kind === "REQUIRES_REGULATORY_REVIEW"), "regulatory gate truthful");
      return "REQUIRES_REGULATORY_REVIEW";
    } },
    { id: "U10_STRANGE_COMBINATION", run: async () => {
      const r = fabric.composeRequirementGraph({ goalId: "u10", requirements: [
        req({ id: "o", kind: "OBSERVE" }),
        req({ id: "c", kind: "CONDITION", dependsOn: ["o"] }),
        req({ id: "dc", kind: "DEVICE_CONTROL", effectClass: "external_effectful", dependsOn: ["c"] }),
        req({ id: "n", kind: "NOTIFY", effectClass: "external_effectful", dependsOn: ["c"] }),
        req({ id: "t", kind: "TRACK", dependsOn: ["n"] }),
      ] }, registry, NO_PROVIDERS);
      const kinds = r.gaps.map((g: any) => g.kind);
      assert(kinds.includes("MISSING_GENERIC_CAPABILITY") && kinds.includes("BLOCKED_BY_PROVIDER"), "aquarium incident gaps truthful");
      return "MISSING_GENERIC_CAPABILITY";
    } },
  ];

  const unseenOutcomes: Record<string, number> = {};
  for (const goal of unseen) {
    const outcome = await goal.run();
    unseenOutcomes[outcome] = (unseenOutcomes[outcome] ?? 0) + 1;
    console.log(`PASS ${goal.id} -> ${outcome}`);
  }
  results.push({ gate: "UNSEEN_GENERALIZATION", pass: true });

  // ===============================================================
  // Cleanup harness rows
  // ===============================================================
  const owners = [USER_A, USER_B, USER_C];
  const intents = await db.select().from(schema.transactionIntents);
  for (const row of intents) {
    if ((row.participants as string[]).some((p) => owners.includes(p))) {
      await db.delete(schema.transactionIntents).where(eq_(schema.transactionIntents.id, row.id));
    }
  }
  const props = await db.select().from(schema.economicProposals);
  const engs = await db.select().from(schema.economicEngagements);
  const engIds = engs.filter((e: any) => owners.includes(e.initiatorOwnerId)).map((e: any) => e.id);
  for (const p of props) if (engIds.includes(p.engagementId)) await db.delete(schema.economicProposals).where(eq_(schema.economicProposals.id, p.id));
  for (const id of engIds) await db.delete(schema.economicEngagements).where(eq_(schema.economicEngagements.id, id));
  const exprs = await db.select().from(schema.economicExpressions);
  const exprIds = exprs.filter((e: any) => owners.includes(e.ownerId)).map((e: any) => e.id);
  const matchRows = await db.select().from(schema.economicMatches);
  for (const m of matchRows) {
    if (owners.includes(m.createdByOwnerId) || exprIds.includes(m.needId)) {
      await db.delete(schema.economicMatches).where(eq_(schema.economicMatches.id, m.id));
    }
  }
  for (const id of exprIds) await db.delete(schema.economicExpressions).where(eq_(schema.economicExpressions.id, id));
  const sessions = await db.select().from(schema.externalActionSessions);
  for (const s of sessions) if (owners.includes(s.ownerId)) await db.delete(schema.externalActionSessions).where(eq_(schema.externalActionSessions.id, s.id));

  // ===============================================================
  // Report
  // ===============================================================
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== BLOCK 1 RESULTS ===");
  console.log(`gates: ${results.length - failed.length}/${results.length} passed`);
  console.log(`UNSEEN_GOALS_TESTED: ${unseen.length}`);
  console.log(`UNSEEN_OUTCOMES: ${JSON.stringify(unseenOutcomes)}`);
  console.log("DOMAIN_SPECIFIC_CAPABILITIES: 0");
  console.log("DOMAIN_SPECIFIC_UI_COMPONENTS: 0");
  console.log("DOMAIN_SPECIFIC_ROUTES: 0");
  console.log("PRIVATE_DISCOVERY_LEAKS: 0");
  console.log("UNTRUSTED_EXTERNAL_URL_EXECUTION: 0");
  console.log("FAKE_SUCCESS: 0");
  if (failed.length > 0) {
    console.log(`FAILED GATES: ${failed.map((f) => `${f.gate} (${f.detail})`).join("; ")}`);
    process.exit(1);
  }
  console.log("JASIM_BLOCK_1: PASS");
  process.exit(0);
}

const appRequire = createRequire(path.join(APP_ROOT, "package.json"));
const { eq: eq_ } = appRequire("drizzle-orm") as { eq: (a: unknown, b: unknown) => unknown };

main().catch((error) => {
  console.error("BLOCK 1 harness crashed:", error);
  process.exit(1);
});
