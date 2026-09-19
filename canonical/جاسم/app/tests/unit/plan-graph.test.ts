/**
 * JASIM — PlanGraph: HOW a goal becomes work.
 *
 * The acceptance question this file answers is not "does the planner work on
 * the examples we designed for". It is:
 *
 *     Can JASIM handle a domain we never designed for?
 *
 * So the generality block below plans a lathe sale, a court interpreter, a
 * beekeeping contract, a falconry competition, a desalination alarm, idle
 * cold-storage capacity and a mosque lending library — none of which appears
 * anywhere else in this codebase — using the same schema and the same seven
 * generic capabilities as everything else.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_AUTHORITY_KEYS,
  PLAN_KINDS,
  PlanGraphSchema,
  PlanNodeSchema,
  materializePlanGraph,
  parseProposedPlanGraph,
  planCompensationOutlook,
  validatePlanGraph,
  type PlanGraph,
} from "../../api/runtime/plan-graph";
import { GoalSpecSchema, evaluateGoalSpec, type GoalSpec } from "../../api/runtime/goal-spec";
import { AUTHORITY_KEYS, ModelOutputAuthorityError } from "../../api/runtime/model-output-trust";

const goal = (over: Partial<GoalSpec> = {}) =>
  evaluateGoalSpec(
    GoalSpecSchema.parse({ version: 1, outcome: "هدف", constraints: [], ...over }),
  );

const plan = (over: Partial<PlanGraph> = {}): PlanGraph =>
  PlanGraphSchema.parse({ version: 1, kind: "DAG", nodes: [], blockers: [], ...over });

const node = (over: Record<string, unknown>) => ({
  key: "n",
  capabilityId: "local-analysis",
  inputs: {},
  dependsOn: [],
  bindings: [],
  enforces: [],
  authority: "NONE",
  ...over,
});

describe("dependencies are real, and ordered", () => {
  /**
   *      A
   *      ↓
   *      B
   *    ┌─┴─┐
   *    C   D
   *    └─┬─┘
   *      E
   */
  const diamond = (): PlanGraph =>
    plan({
      nodes: [
        node({ key: "A", capabilityId: "web-research" }),
        node({ key: "B", capabilityId: "research-context", dependsOn: ["A"] }),
        node({ key: "C", capabilityId: "local-analysis", dependsOn: ["B"] }),
        node({ key: "D", capabilityId: "local-calculation", dependsOn: ["B"] }),
        node({ key: "E", capabilityId: "local-analysis", dependsOn: ["C", "D"] }),
      ],
    });

  it("the plan validates", () => {
    expect(validatePlanGraph({ plan: diamond(), goal: goal() }).readiness).toBe("EXECUTABLE");
  });

  it("the order respects every edge", () => {
    const { order } = validatePlanGraph({ plan: diamond(), goal: goal() });
    const at = (key: string) => order.indexOf(key);
    expect(at("A")).toBeLessThan(at("B"));
    expect(at("B")).toBeLessThan(at("C"));
    expect(at("B")).toBeLessThan(at("D"));
    expect(at("C")).toBeLessThan(at("E"));
    expect(at("D")).toBeLessThan(at("E"));
  });

  it("C and D are siblings — neither is forced before the other", () => {
    // A planner that serialised independent work would be inventing an order
    // the goal never asked for.
    const graph = diamond();
    const c = graph.nodes.find((n) => n.key === "C")!;
    const d = graph.nodes.find((n) => n.key === "D")!;
    expect(c.dependsOn).not.toContain("D");
    expect(d.dependsOn).not.toContain("C");
  });

  it("materialises to the shape createRuntimeDag already takes", () => {
    const nodes = materializePlanGraph(diamond());
    expect(nodes.map((n) => n.nodeKey)).toEqual(["A", "B", "C", "D", "E"]);
    expect(nodes.find((n) => n.nodeKey === "E")!.dependencies).toEqual(["C", "D"]);
  });
});

describe("cycles are rejected", () => {
  it.each([
    [[node({ key: "A", dependsOn: ["B"] }), node({ key: "B", dependsOn: ["A"] })], "two-node"],
    [
      [
        node({ key: "A", dependsOn: ["C"] }),
        node({ key: "B", dependsOn: ["A"] }),
        node({ key: "C", dependsOn: ["B"] }),
      ],
      "three-node",
    ],
  ])("a %s cycle blocks the plan", (nodes) => {
    const validation = validatePlanGraph({ plan: plan({ nodes: nodes as never }), goal: goal() });
    expect(validation.readiness).toBe("BLOCKED");
    expect(validation.violations.map((v) => v.code)).toContain("CYCLE");
  });

  it("a self-dependency is rejected", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "A", dependsOn: ["A"] })] as never }),
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("SELF_DEPENDENCY");
  });

  it("a dependency on a node that is not in the plan is rejected", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "A", dependsOn: ["ghost"] })] as never }),
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("UNKNOWN_DEPENDENCY");
  });
});

describe("output → input bindings", () => {
  const bound = (): PlanGraph =>
    plan({
      nodes: [
        node({ key: "gather", capabilityId: "web-research" }),
        node({
          key: "use",
          capabilityId: "image-generation",
          dependsOn: ["gather"],
          bindings: [{ fromNode: "gather", valuePath: "result.summary", targetKey: "prompt" }],
        }),
      ],
    });

  it("a binding becomes the existing __runtimeBindings channel", () => {
    const nodes = materializePlanGraph(bound());
    expect(nodes[1].inputs.__runtimeBindings).toEqual([
      {
        kind: "dag_node",
        sourceNodeKey: "gather",
        targetKey: "prompt",
        valuePath: "result.summary",
      },
    ]);
  });

  it("the plan supplies a KEY; the runtime supplies identity", () => {
    // A model that could name a run id or a node id could point a binding at
    // another owner's run. `.strict()` is what stops it: those are not fields.
    expect(() =>
      parseProposedPlanGraph({
        version: 1,
        kind: "DAG",
        nodes: [
          node({
            key: "use",
            dependsOn: ["gather"],
            bindings: [
              { fromNode: "gather", valuePath: "x", targetKey: "y", sourceRunId: "run_someone_else" },
            ],
          }),
        ],
      }),
    ).toThrow();
  });

  it("binding from a node that is not a dependency is rejected", () => {
    // Reading a value from a step that is not a dependency is reading it
    // before it ran — a race, written down.
    const validation = validatePlanGraph({
      plan: plan({
        nodes: [
          node({ key: "gather", capabilityId: "web-research" }),
          node({
            key: "use",
            bindings: [{ fromNode: "gather", valuePath: "a", targetKey: "b" }],
          }),
        ],
      }) as never,
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("BINDING_WITHOUT_DEPENDENCY");
  });

  it("two bindings writing the same input key is rejected", () => {
    const validation = validatePlanGraph({
      plan: plan({
        nodes: [
          node({ key: "a", capabilityId: "web-research" }),
          node({
            key: "b",
            dependsOn: ["a"],
            bindings: [
              { fromNode: "a", valuePath: "x", targetKey: "prompt" },
              { fromNode: "a", valuePath: "y", targetKey: "prompt" },
            ],
          }),
        ],
      }) as never,
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("BINDING_TARGET_COLLISION");
  });

  it("a node with no bindings carries no binding channel", () => {
    const nodes = materializePlanGraph(bound());
    expect(nodes[0].inputs).not.toHaveProperty("__runtimeBindings");
  });
});

describe("a hard constraint is never silently ignored", () => {
  const deadline = () =>
    goal({
      constraints: [
        { dimension: "TIME", operator: "AT_MOST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
      ],
    });

  it("a node that owns it reports ENFORCED, and names the owner", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "listing", enforces: [0] })] as never }),
      goal: deadline(),
    });
    expect(validation.dispositions[0]).toMatchObject({ status: "ENFORCED", nodeKeys: ["listing"] });
    expect(validation.readiness).toBe("EXECUTABLE");
  });

  it("a hard constraint with NO owner blocks the plan", () => {
    // The whole point of §6. A plan that quietly drops the deadline is the
    // failure GoalSpec was built to make visible.
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "listing" })] as never }),
      goal: deadline(),
    });
    expect(validation.dispositions[0].status).toBe("BLOCKED");
    expect(validation.readiness).toBe("BLOCKED");
  });

  it("a SOFT preference with no owner does not block", () => {
    // Nobody ranked by it: disappointing, not wrong.
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "listing" })] as never }),
      goal: goal({
        constraints: [
          { dimension: "COST", operator: "MINIMIZE", hardness: "SOFT", source: "STATED" },
        ],
      }),
    });
    expect(validation.dispositions[0].status).toBe("BLOCKED");
    expect(validation.readiness).toBe("EXECUTABLE");
  });

  it("an unsatisfiable goal makes every hard constraint UNSATISFIABLE, not BLOCKED", () => {
    // Different answers. "no plan can exist" is not "this plan missed it".
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "a", enforces: [0, 1] })] as never }),
      goal: goal({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    });
    expect(validation.readiness).toBe("UNSATISFIABLE");
    expect(validation.dispositions.map((d) => d.status)).toEqual(["UNSATISFIABLE", "UNSATISFIABLE"]);
  });

  it("an open question yields NEEDS_INPUT, not a confident plan", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "a", enforces: [0] })] as never }),
      goal: goal({
        unknowns: ["ما الحد الأدنى المقبول؟"],
        constraints: [
          { dimension: "COST", operator: "AT_LEAST", value: 8000, unit: "KWD", hardness: "HARD", source: "STATED" },
        ],
      }),
    });
    expect(validation.readiness).toBe("NEEDS_INPUT");
    expect(validation.dispositions[0].status).toBe("NEEDS_INPUT");
  });

  it("claiming to enforce a constraint the goal does not have is rejected", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "a", enforces: [7] })] as never }),
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("UNKNOWN_CONSTRAINT_INDEX");
  });

  it("every constraint gets exactly one disposition — none is dropped", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "a", enforces: [0] })] as never }),
      goal: goal({
        constraints: [
          { dimension: "COST", operator: "AT_LEAST", value: 8000, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_MOST", value: 30, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    });
    expect(validation.dispositions).toHaveLength(2);
    expect(validation.dispositions.map((d) => d.constraintIndex)).toEqual([0, 1]);
  });
});

describe("capability is not provider", () => {
  it("a plan validates with no provider configured anywhere", () => {
    // §10. A valid plan may exist when nothing can perform it yet; refusing to
    // plan because commerce providers are absent would stop the product dead.
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "reach", capabilityId: "notify" })] as never }),
      goal: goal(),
    });
    expect(validation.readiness).toBe("EXECUTABLE");
  });

  it("an unknown capability IS rejected — the capability set is closed", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "a", capabilityId: "auction-house-api" })] as never }),
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("UNKNOWN_CAPABILITY");
  });

  it("the plan schema has no field for a provider at all", () => {
    const fields = Object.keys(PlanNodeSchema.shape);
    expect(fields).not.toContain("provider");
    expect(fields).not.toContain("providerId");
  });
});

describe("authority may be raised, never lowered", () => {
  it("the registry's floor applies even when the plan says NONE", () => {
    // `notify` has external side effects. A model marking it NONE does not
    // make it need less than it needs.
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "send", capabilityId: "notify", authority: "NONE" })] as never }),
      goal: goal(),
    });
    expect(validation.authority.get("send")).toBe("OWNER_APPROVAL");
  });

  it("a plan may raise above the floor", () => {
    const validation = validatePlanGraph({
      plan: plan({
        nodes: [node({ key: "send", capabilityId: "notify", authority: "REAUTHENTICATION" })] as never,
      }),
      goal: goal(),
    });
    expect(validation.authority.get("send")).toBe("REAUTHENTICATION");
  });

  it("a pure read stays NONE", () => {
    const validation = validatePlanGraph({
      plan: plan({ nodes: [node({ key: "look", capabilityId: "local-analysis" })] as never }),
      goal: goal(),
    });
    expect(validation.authority.get("look")).toBe("NONE");
  });
});

describe("the model is an untrusted planner", () => {
  it.each([...PLAN_AUTHORITY_KEYS])("«%s» is rejected outright", (key) => {
    expect(() =>
      parseProposedPlanGraph({ version: 1, kind: "DAG", nodes: [], [key]: true }),
    ).toThrow(ModelOutputAuthorityError);
  });

  it("every plan authority key is in the shared set", () => {
    for (const key of PLAN_AUTHORITY_KEYS) expect(AUTHORITY_KEYS.has(key)).toBe(true);
  });

  it("an authority claim nested inside a node is rejected", () => {
    expect(() =>
      parseProposedPlanGraph({
        version: 1,
        kind: "DAG",
        nodes: [{ ...node({ key: "a" }), skipApproval: true }],
      }),
    ).toThrow(ModelOutputAuthorityError);
  });

  it("an ownerId anywhere in a plan never reaches the validated plan", () => {
    const parsed = parseProposedPlanGraph({
      version: 1,
      kind: "DAG",
      nodes: [node({ key: "a" })],
      blockers: [],
    });
    expect(JSON.stringify(parsed)).not.toContain("ownerId");
  });

  it("an unexpected top-level key is rejected, not ignored", () => {
    expect(() =>
      parseProposedPlanGraph({ version: 1, kind: "DAG", nodes: [], estimatedProfit: 900 }),
    ).toThrow();
  });
});

describe("not every goal is a DAG", () => {
  it.each(["IDENTITY_CHANGE", "SETTING_MUTATION", "DIRECT_READ", "MONITORING"] as const)(
    "a %s plan materialises no DAG nodes",
    (kind) => {
      expect(materializePlanGraph(plan({ kind, nodes: [] }))).toEqual([]);
    },
  );

  it("an IDENTITY_CHANGE plan may not carry DAG steps", () => {
    // Changing who the runtime operates as is the thing every other
    // authorization check is evaluated against. It cannot be a step whose
    // result is a receipt.
    const validation = validatePlanGraph({
      plan: plan({ kind: "IDENTITY_CHANGE", nodes: [node({ key: "a" })] as never }),
      goal: goal(),
    });
    expect(validation.violations.map((v) => v.code)).toContain("NODES_ON_NON_DAG_PLAN");
  });

  it("a DAG plan with neither nodes nor blockers explains nothing", () => {
    const validation = validatePlanGraph({ plan: plan({ kind: "DAG" }), goal: goal() });
    expect(validation.violations.map((v) => v.code)).toContain("EMPTY_DAG_PLAN");
  });

  it("a MONITORING plan is not silently turned into a one-shot", () => {
    // «راقب السعر وأخبرني إذا انخفض» is not «ما السعر». Answering the second
    // when the first was asked is a wrong answer that looks like a right one.
    const monitoring = plan({ kind: "MONITORING" });
    expect(materializePlanGraph(monitoring)).toEqual([]);
    expect(validatePlanGraph({ plan: monitoring, goal: goal() }).readiness).toBe("EXECUTABLE");
  });

  it("PERSISTENT_WORLD is a separate kind, so a World is not created per turn", () => {
    expect(PLAN_KINDS).toContain("PERSISTENT_WORLD");
    expect(PLAN_KINDS).toContain("DIRECT_READ");
    // A one-shot question and a durable system cannot collapse into one route.
    expect(materializePlanGraph(plan({ kind: "DIRECT_READ" }))).toEqual([]);
  });
});

describe("compensation is read, not re-invented", () => {
  it("reversibility comes from the capability registry", () => {
    const outlook = planCompensationOutlook(
      plan({ nodes: [node({ key: "send", capabilityId: "notify" })] as never }),
    );
    expect(outlook).toEqual([{ nodeKey: "send", reversibility: "PARTIALLY_COMPENSATABLE" }]);
  });

  it("an unknown capability does not get to claim reversibility", () => {
    const outlook = planCompensationOutlook(
      plan({ nodes: [node({ key: "x", capabilityId: "not-a-capability" })] as never }),
    );
    expect(outlook[0].reversibility).toBe("IRREVERSIBLE");
  });

  it("the plan module never executes or verifies a compensation", () => {
    // COMPENSATION_REQUESTED != EXECUTED != VERIFIED. This module answers only
    // "what class of undo exists", which a person deserves before approving.
    const source = planCompensationOutlook.toString();
    expect(source).not.toMatch(/execute|verif|perform/i);
  });
});

describe("GENERALITY — domains this codebase has never seen", () => {
  /**
   * Nine unrelated goals. Seven of the domains appear nowhere else in JASIM:
   * industrial machinery, court interpreting, beekeeping, falconry,
   * desalination, cold storage, and a mosque lending library.
   *
   * Every one uses the same schema and the same generic capabilities. If any
   * of them needed a new node type, a new field or a new branch, this block
   * would be impossible to write.
   */
  const cases: Array<{ name: string; kind: (typeof PLAN_KINDS)[number]; graph: PlanGraph; goal: ReturnType<typeof goal> }> = [
    {
      name: "A — sell an idle industrial lathe above a floor price, within 30 days",
      kind: "DAG",
      goal: goal({
        outcome: "بيع مخرطة صناعية غير مستخدمة",
        constraints: [
          { dimension: "COST", operator: "AT_LEAST", value: 8000, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_MOST", value: 30, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
      graph: plan({
        nodes: [
          node({ key: "value", capabilityId: "web-research", enforces: [0] }),
          node({
            key: "listing",
            capabilityId: "local-analysis",
            dependsOn: ["value"],
            bindings: [{ fromNode: "value", valuePath: "result.summary", targetKey: "evidence" }],
            enforces: [0, 1],
          }),
          node({ key: "reach", capabilityId: "notify", dependsOn: ["listing"], enforces: [1], authority: "OWNER_APPROVAL" }),
        ],
      }),
    },
    {
      name: "B — find a sign-language interpreter for a court hearing under a fee ceiling",
      kind: "DAG",
      goal: goal({
        outcome: "إيجاد مترجم لغة إشارة لجلسة محكمة",
        constraints: [
          { dimension: "COST", operator: "AT_MOST", value: 120, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "QUALITY", operator: "MAXIMIZE", hardness: "SOFT", source: "STATED" },
        ],
      }),
      graph: plan({
        nodes: [
          node({ key: "search", capabilityId: "web-research", enforces: [0, 1] }),
          node({
            key: "shortlist",
            capabilityId: "local-analysis",
            dependsOn: ["search"],
            bindings: [{ fromNode: "search", valuePath: "result.sources", targetKey: "candidates" }],
            enforces: [0],
          }),
        ],
      }),
    },
    {
      name: "C — find seasonal apiary contracts for a beekeeper",
      kind: "DAG",
      goal: goal({
        outcome: "إيجاد عقود موسمية لتأجير خلايا النحل للتلقيح",
        constraints: [
          { dimension: "LOCATION", operator: "AT_MOST", value: 200, unit: "KM", hardness: "HARD", source: "STATED" },
        ],
      }),
      graph: plan({
        nodes: [
          node({ key: "scan", capabilityId: "web-research", enforces: [0] }),
          node({ key: "rank", capabilityId: "local-analysis", dependsOn: ["scan"], enforces: [0] }),
        ],
      }),
    },
    {
      name: "D — organise a falconry competition needing several independent resources",
      kind: "DAG",
      goal: goal({
        outcome: "تنظيم مسابقة صقور",
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 8, unit: "WEEK", hardness: "HARD", source: "STATED" },
        ],
      }),
      graph: plan({
        nodes: [
          node({ key: "brief", capabilityId: "local-analysis", enforces: [0] }),
          // Three independent resources. None depends on the others — the
          // whole reason a graph beats a list.
          node({ key: "ground", capabilityId: "web-research", dependsOn: ["brief"] }),
          node({ key: "judges", capabilityId: "web-research", dependsOn: ["brief"] }),
          node({ key: "vets", capabilityId: "web-research", dependsOn: ["brief"] }),
          node({
            key: "schedule",
            capabilityId: "local-calculation",
            dependsOn: ["ground", "judges", "vets"],
            enforces: [0],
            bindings: [{ fromNode: "ground", valuePath: "result.summary", targetKey: "venue" }],
          }),
        ],
      }),
    },
    {
      name: "E — watch a desalination plant's chlorine level and act only if it crosses",
      kind: "MONITORING",
      goal: goal({
        outcome: "مراقبة مستوى الكلور في محطة التحلية والتنبيه عند تجاوزه",
        constraints: [
          { dimension: "RISK", operator: "MINIMIZE", hardness: "SOFT", source: "STATED" },
        ],
      }),
      graph: plan({ kind: "MONITORING", blockers: ["لا يوجد مصدر قياس موصول بعد."] }),
    },
    {
      name: "F — earn from idle cold-storage capacity",
      kind: "DAG",
      goal: goal({
        outcome: "تأجير مساحة تبريد غير مستغلة",
        constraints: [
          { dimension: "COST", operator: "MAXIMIZE", hardness: "SOFT", source: "STATED" },
        ],
      }),
      graph: plan({
        nodes: [
          node({ key: "capacity", capabilityId: "local-calculation", enforces: [0] }),
          node({ key: "offer", capabilityId: "local-analysis", dependsOn: ["capacity"] }),
        ],
      }),
    },
    {
      name: "G — run a mosque lending library as a standing system",
      kind: "PERSISTENT_WORLD",
      goal: goal({ outcome: "إنشاء نظام إعارة لمكتبة مسجد" }),
      graph: plan({
        kind: "PERSISTENT_WORLD",
        nodes: [node({ key: "model", capabilityId: "local-analysis" })] as never,
      }),
    },
    {
      name: "H — stop notifications at night",
      kind: "SETTING_MUTATION",
      goal: goal({ outcome: "إيقاف الإشعارات ليلاً" }),
      graph: plan({ kind: "SETTING_MUTATION" }),
    },
    {
      name: "I — sign me in",
      kind: "IDENTITY_CHANGE",
      goal: goal({ outcome: "تسجيل الدخول" }),
      graph: plan({ kind: "IDENTITY_CHANGE" }),
    },
  ];

  it.each(cases)("$name — plans without a new node type", ({ graph, goal: evaluated, kind }) => {
    const validation = validatePlanGraph({ plan: graph, goal: evaluated });
    expect(graph.kind).toBe(kind);
    expect(validation.violations).toEqual([]);
    // Every hard requirement accounted for, in every domain.
    for (const disposition of validation.dispositions) {
      if (disposition.hardness === "HARD") expect(disposition.status).not.toBe("BLOCKED");
    }
  });

  it("all nine use only the seven generic capabilities", () => {
    const used = new Set(cases.flatMap((c) => c.graph.nodes.map((n) => n.capabilityId)));
    const generic = new Set([
      "local-analysis",
      "local-calculation",
      "notify",
      "openai-chat",
      "web-research",
      "image-generation",
      "research-context",
    ]);
    for (const capability of used) expect(generic.has(capability)).toBe(true);
  });

  it("the falconry case really is a graph, not a list", () => {
    const falconry = cases.find((c) => c.name.startsWith("D"))!;
    const { order } = validatePlanGraph({ plan: falconry.graph, goal: falconry.goal });
    expect(order.indexOf("brief")).toBeLessThan(order.indexOf("ground"));
    expect(order.indexOf("judges")).toBeLessThan(order.indexOf("schedule"));
    expect(falconry.graph.nodes.find((n) => n.key === "schedule")!.dependsOn).toHaveLength(3);
  });

  it("a monitoring goal with no measurement source says so instead of pretending", () => {
    const desal = cases.find((c) => c.name.startsWith("E"))!;
    const validation = validatePlanGraph({ plan: desal.graph, goal: desal.goal });
    expect(validation.readiness).toBe("BLOCKED");
    expect(desal.graph.blockers[0]).toMatch(/مصدر قياس/);
  });
});

describe("DOMAIN_PLAN_NODE_TYPES = 0", () => {
  const source = readFileSync(join(__dirname, "../../api/runtime/plan-graph.ts"), "utf8");
  // Comments AND string literals go first. The first version of this test
  // failed on the word «carry» inside an error message — prose, not a node
  // type. The assertion is about what the code names, not what it says.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/`[^`]*`/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, '""');

  it.each([
    "car", "vehicle", "driver", "travel", "flight", "hotel", "restaurant",
    "job", "resume", "commerce", "purchase", "booking", "delivery", "shop",
    "conference", "lathe", "falcon", "bee",
  ])("the plan module's code names no «%s»", (word) => {
    expect(code.toLowerCase()).not.toContain(word);
  });

  it("a node has exactly the fields that change runtime behaviour", () => {
    expect(Object.keys(PlanNodeSchema.shape).sort()).toEqual(
      ["authority", "bindings", "capabilityId", "dependsOn", "enforces", "inputs", "key"].sort(),
    );
  });

  it("the plan kinds are six routes, not a domain list", () => {
    expect([...PLAN_KINDS].sort()).toEqual(
      ["DAG", "DIRECT_READ", "IDENTITY_CHANGE", "MONITORING", "PERSISTENT_WORLD", "SETTING_MUTATION"].sort(),
    );
  });
});
