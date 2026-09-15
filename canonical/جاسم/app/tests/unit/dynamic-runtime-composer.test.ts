import { describe, expect, it } from "vitest";
import type { IntentStructure } from "@contracts/dna";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import { DynamicRuntimeComposer } from "../../api/core/dynamic-runtime-composer";
import { parseDeterministicIntent } from "../../api/core/deterministic-intent";
import { findRuntimeApprovalBoundary } from "../../api/core/runtime-approval";

function deliveryIntent(goal: string, resourceName: string): IntentStructure {
  return {
    goal,
    actors: [
      { role: "user" },
      { role: "source_provider" },
      { role: "fulfillment_provider" },
    ],
    objects: [{ name: resourceName, type: "resource", attributes: {} }],
    actions: ["search", "buy", "delegate", "track"],
    constraints: [{ type: "location", field: "location", operator: "near", value: "user_location" }],
    desiredOutcomes: ["resource acquired and delivered"],
    unknowns: ["exact selection", "delivery address"],
    domainHints: ["acquisition", "fulfillment"],
    confidence: 0.9,
  };
}

describe("JASIM dynamic runtime composition", () => {
  it("understands the Arabic restaurant and nearby-driver goal without a domain app", () => {
    const intent = parseDeterministicIntent(
      "جاسم أريد طعام من مطعم فلاني للوجبات السريعة وشوف سائق قريب يوصله لي",
    );

    expect(intent.actors.map((actor) => actor.role)).toEqual(
      expect.arrayContaining(["source_provider", "fulfillment_provider"]),
    );
    expect(intent.actions).toEqual(expect.arrayContaining(["buy", "delegate"]));
    expect(intent.domainHints).toEqual(expect.arrayContaining(["acquisition", "fulfillment"]));
    expect(intent.constraints.some((constraint) => constraint.type === "location")).toBe(true);
  });

  it("generates the complete Arabic acquisition and delivery runtime without domain apps", () => {
    const intent = deliveryIntent(
      "أريد طعام من مطعم فلاني للوجبات السريعة وشوف سائق قريب يوصله لي",
      "الوجبة المطلوبة",
    );
    const composition = new DynamicRuntimeComposer().compose(intent);
    const capabilities = composition.plan.steps.map((step) => step.capabilityId);

    expect(capabilities).toEqual(expect.arrayContaining([
      DNA_PRIMITIVES.UNDERSTAND,
      DNA_PRIMITIVES.SEARCH,
      DNA_PRIMITIVES.RETRIEVE,
      DNA_PRIMITIVES.MATCH,
      DNA_PRIMITIVES.CONFIRM,
      DNA_PRIMITIVES.BUY,
      DNA_PRIMITIVES.DELEGATE,
      DNA_PRIMITIVES.TRACK,
      DNA_PRIMITIVES.VERIFY,
    ]));
    expect(composition.plan.steps.find((step) => step.capabilityId === DNA_PRIMITIVES.BUY)).toMatchObject({
      requiresApproval: true,
      risk: "high",
    });
    expect(composition.world.generatedFrom).toBe(intent.goal);
    expect(composition.world.ui.map((screen) => screen.type)).toEqual(
      expect.arrayContaining(["search", "map", "confirmation", "progress"]),
    );
    expect(composition.bubbles.map((bubble) => bubble.type)).toEqual(
      expect.arrayContaining(["search", "map", "confirmation", "progress"]),
    );
    expect(composition.agents.length).toBeGreaterThanOrEqual(3);
    expect(composition.agents.every((agent) => agent.lifetime === "task" && agent.disposeWhen === "task_terminal")).toBe(true);
    expect(JSON.stringify(composition)).not.toMatch(/FoodAgent|FleetAgent|Food\.tsx|Fleet\.tsx/);
  });

  it("uses the same generic composer for a different resource", () => {
    const meal = new DynamicRuntimeComposer().compose(deliveryIntent(
      "أريد وجبة من مصدر محدد ويوصلها سائق قريب",
      "وجبة",
    ));
    const book = new DynamicRuntimeComposer().compose(deliveryIntent(
      "أريد كتاباً من متجر محدد ويوصله مندوب قريب",
      "كتاب",
    ));

    expect(book.plan.steps.map((step) => step.capabilityId)).toEqual(
      meal.plan.steps.map((step) => step.capabilityId),
    );
    expect(book.world.entities.map((entity) => entity.fields.map((field) => field.type))).toEqual(
      meal.world.entities.map((entity) => entity.fields.map((field) => field.type)),
    );
    expect(book.world.entities[1]?.id).not.toBe(meal.world.entities[1]?.id);
    expect(book.world.generatedFrom).not.toBe(meal.world.generatedFrom);
  });

  it("creates a valid acyclic dependency graph with confirmation before commitment", () => {
    const composition = new DynamicRuntimeComposer().compose(deliveryIntent(
      "اشتر غرضاً وابحث عن مندوب قريب لتوصيله",
      "غرض",
    ));
    const byId = new Map(composition.plan.steps.map((step) => [step.id, step]));
    for (const step of composition.plan.steps) {
      for (const dependency of step.dependencies) expect(byId.has(dependency)).toBe(true);
    }
    const commit = byId.get("step_create_commitment")!;
    expect(commit.dependencies).toContain("step_confirm_commitment");
    const delegation = byId.get("step_delegate_fulfillment")!;
    expect(delegation.dependencies).toContain("step_create_commitment");
  });

  it("identifies the generated approval boundary before side effects", () => {
    const composition = new DynamicRuntimeComposer().compose(deliveryIntent(
      "اشتر غرضاً وابحث عن مندوب قريب لتوصيله",
      "غرض",
    ));
    const confirmation = composition.plan.steps.find((step) => step.id === "step_confirm_commitment")!;
    const boundary = findRuntimeApprovalBoundary([confirmation]);

    expect(boundary?.id).toBe("step_confirm_commitment");
    expect(boundary?.requiresApproval).toBe(true);
  });

  it("composes a personal watch sale from evidence without a watch application", () => {
    const intent = parseDeterministicIntent(
      "أريد بيع ساعة والدي، سأرسل صورة وأريد من جاسم تقييم السعر وإيجاد المهتمين",
    );
    intent.objects[0]!.attributes.suppliedAttachments = [
      { type: "image", url: "https://files.example.test/father-watch.jpg" },
    ];
    const composition = new DynamicRuntimeComposer().compose(intent);
    const capabilities = composition.plan.steps.map((step) => step.capabilityId);

    expect(intent.objects[0]?.name).toContain("ساعة والدي");
    expect(intent.actions).toContain("sell");
    expect(intent.actions).not.toContain("buy");
    expect(composition.world.continuity).toBe("ephemeral");
    expect(capabilities).toEqual(expect.arrayContaining([
      DNA_PRIMITIVES.VISION,
      DNA_PRIMITIVES.SEARCH,
      DNA_PRIMITIVES.ANALYZE,
      DNA_PRIMITIVES.GENERATE,
      DNA_PRIMITIVES.LIST,
      DNA_PRIMITIVES.MATCH,
      DNA_PRIMITIVES.NEGOTIATE,
      DNA_PRIMITIVES.SELL,
    ]));
    expect(composition.world.entities.some((entity) => entity.label.includes("ساعة والدي"))).toBe(true);
    expect(composition.plan.steps.find((step) => step.capabilityId === DNA_PRIMITIVES.VISION)?.inputs.evidence).toEqual(
      expect.arrayContaining([{ type: "image", url: "https://files.example.test/father-watch.jpg" }]),
    );
    expect(composition.bubbles).toHaveLength(composition.world.ui.length);
    expect(composition.bubbles.some((bubble) =>
      bubble.actions.some((action) => action.capabilityBinding === DNA_PRIMITIVES.VISION),
    )).toBe(true);
    expect(JSON.stringify(composition)).not.toMatch(/WatchBubble|WatchAgent|watch\.tsx/i);
  });

  it("generates an evolving shop world without stored membership types", () => {
    const intent = parseDeterministicIntent(
      "أنا صاحب محل ملابس، أريد منصة داخل جاسم لإدارة محتويات المحل والعملاء",
    );
    const composition = new DynamicRuntimeComposer().compose(intent);
    const capabilities = composition.plan.steps.map((step) => step.capabilityId);

    expect(composition.world.continuity).toBe("evolving");
    expect(capabilities).toEqual(expect.arrayContaining([
      DNA_PRIMITIVES.ANALYZE,
      DNA_PRIMITIVES.GENERATE,
      DNA_PRIMITIVES.CONFIRM,
      DNA_PRIMITIVES.PERSIST,
    ]));
    expect(capabilities).not.toContain(DNA_PRIMITIVES.BUY);
    expect(composition.world.participants.map((participant) => participant.role)).toEqual(
      expect.arrayContaining(intent.actors.map((actor) => actor.role)),
    );
    expect(composition.world.participants.every((participant) => participant.source === "intent")).toBe(true);
    expect(composition.bubbles.every((bubble) => bubble.metadata?.worldId === composition.world.id)).toBe(true);
    expect(JSON.stringify(composition)).not.toMatch(/ClothingBubble|FashionPlatform|clothing\.tsx/i);
  });

  it("uses the same persistent generator for a non-commercial research community", () => {
    const intent = parseDeterministicIntent(
      "أريد مساحة داخل جاسم تجمع الباحثين لتوثيق النباتات الصحراوية ومراجعة الملاحظات",
    );
    const composition = new DynamicRuntimeComposer().compose(intent);
    const capabilities = composition.plan.steps.map((step) => step.capabilityId);

    expect(composition.world.continuity).toBe("evolving");
    expect(composition.world.visibility).toBe("shared");
    expect(capabilities).toContain(DNA_PRIMITIVES.PERSIST);
    expect(capabilities).not.toContain(DNA_PRIMITIVES.BUY);
    expect(capabilities).not.toContain(DNA_PRIMITIVES.SELL);
    expect(composition.bubbles.length).toBeGreaterThan(0);
  });
});
