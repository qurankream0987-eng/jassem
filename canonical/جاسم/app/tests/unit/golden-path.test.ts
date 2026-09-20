/**
 * JASIM Golden Path Test
 *
 * Acceptance Test: "I want a used furniture marketplace"
 *
 * Must prove:
 * 1. Intent Engine parses the goal into structured intent
 * 2. DNA Descriptor generates a World Definition (NOT hardcoded FurnitureMarketplace.tsx)
 * 3. World contains generic entities: Listing, User, Offer, Transaction, Message
 * 4. Capability Registry resolves generic capabilities bound to entities
 * 5. Planner generates an execution plan (DAG)
 * 6. Generative Runtime orchestrates the entire flow
 * 7. UI Contract is generated from the world
 *
 * Must NOT:
 * - Import any domain-specific code (commerce, escrow, haggle, etc.)
 * - Use hardcoded furniture types
 * - Generate eval()-based code
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getIntentEngine,
  getDNADescriptor,
  getGenerativePlanner,
  getGenerativeRuntime,
  getUIContractGenerator,
} from "../../api/core/gen-runtime";
import { CapabilityResolver } from "../../api/core/gen-runtime";
import { validateWorldDNA, validateExecutionPlan } from "../../contracts/dna";
import type { WorldDNA, ExecutionPlan } from "../../contracts/dna";

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: (column: any, value: any) => ({ _type: "eq", columnName: column?.name || column, value }),
  sql: (...args: any[]) => ({ raw: args.join("") }),
  and: (...conditions: any[]) => ({ _type: "and", conditions }),
  or: (...conditions: any[]) => ({ _type: "or", conditions }),
  inArray: (column: any, values: any[]) => ({ _type: "inArray", columnName: column?.name || column, values }),
  desc: (column: any) => ({ _type: "desc", columnName: column?.name || column }),
  asc: (column: any) => ({ _type: "asc", columnName: column?.name || column }),
  json: (value: any) => JSON.stringify(value),
}));

// Mock DB connection
vi.mock("../../api/queries/connection", () => {
  const stores = new Map<string, Map<number, any>>();
  let nextId = 1;

  function getStore(table: any): Map<number, any> {
    const key = table?.name || "default";
    console.log("[DB MOCK] getStore key:", key, "table:", typeof table, table?.name);
    if (!stores.has(key)) stores.set(key, new Map());
    return stores.get(key)!;
  }

  function evaluateCondition(row: any, condition: any): boolean {
    if (!condition) return true;
    if (condition._type === "eq") return String(row[condition.columnName]) === String(condition.value);
    if (condition._type === "and") return condition.conditions.every((c: any) => evaluateCondition(row, c));
    if (condition._type === "or") return condition.conditions.some((c: any) => evaluateCondition(row, c));
    return true;
  }

  const db = {
    insert(table: any) {
      const store = getStore(table);
      return {
        values: (data: any) => {
          const items = Array.isArray(data) ? data : [data];
          const results = [];
          for (const item of items) {
            const id = nextId++;
            const row = { ...item, id, createdAt: new Date(), updatedAt: new Date() };
            store.set(id, row);
            results.push({ insertId: id, affectedRows: 1 });
          }
          return Promise.resolve(results);
        },
      };
    },
    select() {
      return {
        from: (table: any) => ({
          where: async (condition: any) => {
            const store = getStore(table);
            return Array.from(store.values()).filter((row) => evaluateCondition(row, condition));
          },
        }),
      };
    },
    update(table: any) {
      const store = getStore(table);
      return {
        set: (data: any) => ({
          where: async (condition: any) => {
            for (const row of store.values()) {
              if (evaluateCondition(row, condition)) {
                Object.assign(row, data, { updatedAt: new Date() });
              }
            }
          },
        }),
      };
    },
    query: {
      capabilities: {
        findFirst: async ({ where }: any) => {
          const store = getStore({ name: "capabilities" });
          const rows = Array.from(store.values());
          // Simple eq filter
          if (where && where._type === "eq") {
            return rows.find((r: any) => String(r[where.columnName]) === String(where.value)) || null;
          }
          return rows[0] || null;
        },
      },
      tasks: {
        findFirst: async ({ where }: any) => {
          const store = getStore({ name: "tasks" });
          const rows = Array.from(store.values());
          if (where && where._type === "eq") {
            return rows.find((r: any) => String(r[where.columnName]) === String(where.value)) || null;
          }
          return rows[0] || null;
        },
      },
      taskSteps: {
        findFirst: async ({ where }: any) => {
          const store = getStore({ name: "taskSteps" });
          const rows = Array.from(store.values());
          if (where && where._type === "eq") {
            return rows.find((r: any) => String(r[where.columnName]) === String(where.value)) || null;
          }
          return rows[0] || null;
        },
        findMany: async ({ where }: any) => {
          const store = getStore({ name: "taskSteps" });
          const rows = Array.from(store.values());
          if (where && where._type === "eq") {
            return rows.filter((r: any) => String(r[where.columnName]) === String(where.value));
          }
          return rows;
        },
      },
    },
  };

  return { db };
});

// Mock db.query capabilities (Drizzle relational API)
vi.mock("../../db/schema", () => ({
  tasks: Object.assign({ id: { name: "id" }, userId: { name: "userId" }, name: { name: "name" }, description: { name: "description" }, goal: { name: "goal" }, status: { name: "status" }, priority: { name: "priority" }, currentStepId: { name: "currentStepId" }, retryCount: { name: "retryCount" }, error: { name: "error" }, observations: { name: "observations" }, parentTaskId: { name: "parentTaskId" }, completionCriteria: { name: "completionCriteria" }, successCriteria: { name: "successCriteria" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "tasks" }),
  taskSteps: Object.assign({ id: { name: "id" }, taskId: { name: "taskId" }, name: { name: "name" }, description: { name: "description" }, type: { name: "type" }, status: { name: "status" }, inputs: { name: "inputs" }, outputs: { name: "outputs" }, dependencies: { name: "dependencies" }, executionHandler: { name: "executionHandler" }, retryCount: { name: "retryCount" }, maxRetries: { name: "maxRetries" }, error: { name: "error" }, startedAt: { name: "startedAt" }, completedAt: { name: "completedAt" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "taskSteps" }),
  capabilities: Object.assign({ id: { name: "id" }, name: { name: "name" }, description: { name: "description" }, version: { name: "version" }, inputSchema: { name: "inputSchema" }, outputSchema: { name: "outputSchema" }, requirements: { name: "requirements" }, permissions: { name: "permissions" }, riskLevel: { name: "riskLevel" }, sideEffects: { name: "sideEffects" }, executionHandler: { name: "executionHandler" }, validationRules: { name: "validationRules" }, metadata: { name: "metadata" }, isActive: { name: "isActive" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "capabilities" }),
  taskEventBus: Object.assign({ id: { name: "id" }, taskId: { name: "taskId" }, type: { name: "type" }, payload: { name: "payload" }, createdAt: { name: "createdAt" } }, { name: "taskEventBus" }),
  securityEvents: Object.assign({ id: { name: "id" }, userId: { name: "userId" }, capabilityId: { name: "capabilityId" }, action: { name: "action" }, result: { name: "result" }, reason: { name: "reason" }, metadata: { name: "metadata" }, createdAt: { name: "createdAt" } }, { name: "securityEvents" }),
  worldDefinitions: Object.assign({ id: { name: "id" }, name: { name: "name" }, description: { name: "description" }, version: { name: "version" }, schema: { name: "schema" }, createdBy: { name: "createdBy" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "worldDefinitions" }),
  entities: Object.assign({ id: { name: "id" }, worldId: { name: "worldId" }, name: { name: "name" }, type: { name: "type" }, attributes: { name: "attributes" }, createdAt: { name: "createdAt" } }, { name: "entities" }),
  relations: Object.assign({ id: { name: "id" }, worldId: { name: "worldId" }, fromEntity: { name: "fromEntity" }, toEntity: { name: "toEntity" }, type: { name: "type" }, createdAt: { name: "createdAt" } }, { name: "relations" }),
  toolInstances: Object.assign({ id: { name: "id" }, name: { name: "name" }, description: { name: "description" }, type: { name: "type" }, config: { name: "config" }, isActive: { name: "isActive" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "toolInstances" }),
  policies: Object.assign({ id: { name: "id" }, name: { name: "name" }, description: { name: "description" }, type: { name: "type" }, rules: { name: "rules" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "policies" }),
  events: Object.assign({ id: { name: "id" }, type: { name: "type" }, payload: { name: "payload" }, processed: { name: "processed" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "events" }),
  // Read by the canonical resource registry, which this test's import chain
  // now reaches. This mock is an explicit whitelist rather than a partial of
  // the real schema, so every table a new module imports has to be listed
  // here or the suite fails to load — which is how this arrived.
  runs: Object.assign({ id: { name: "id" }, ownerId: { name: "ownerId" }, goal: { name: "goal" }, status: { name: "status" }, idempotencyKey: { name: "idempotencyKey" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "runs" }),
  runtimeTasks: Object.assign({ id: { name: "id" }, userId: { name: "userId" }, goal: { name: "goal" }, status: { name: "status" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "runtimeTasks" }),
  conversations: Object.assign({ id: { name: "id" }, userId: { name: "userId" }, title: { name: "title" }, status: { name: "status" }, createdAt: { name: "createdAt" }, updatedAt: { name: "updatedAt" } }, { name: "conversations" }),
}));

// Mock LLM Router to force deterministic fallback paths
vi.mock("../../api/core/llm-router", () => ({
  llmRouter: {
    route: vi.fn(async () => {
      throw new Error("LLM not available — forcing fallback");
    }),
  },
}));



describe("Golden Path: Used Furniture Marketplace", () => {
  const goal = "أريد إنشاء سوق لبيع الأثاث المستعمل بين الأشخاص في نفس المدينة";

  beforeEach(async () => {
    // Seed mock DB with generic capabilities for resolver tests
    const { db } = await import("../../api/queries/connection");
    const { capabilities } = await import("../../db/schema");
    for (const capId of ["generic.CREATE", "generic.READ", "generic.UPDATE", "generic.DELETE", "generic.SEARCH", "generic.FILTER", "generic.SORT", "generic.COMPARE", "generic.CONFIRM", "generic.VERIFY"]) {
      await db.insert(capabilities).values({
        name: capId,
        description: "Generic capability",
        version: "1.0.0",
        inputSchema: {},
        outputSchema: {},
        requirements: [],
        permissions: [],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: "mock",
        validationRules: [],
        metadata: {},
        isActive: true,
      });
    }
  });

  it("Phase GP.1: Intent Engine parses goal into structured intent", async () => {
    const engine = getIntentEngine();
    const intent = await engine.parse(goal);

    expect(intent).toBeDefined();
    expect(intent.goal).toBe(goal);
    // Should detect marketplace domain
    expect(intent.domainHints).toContain("marketplace");
    // Should detect actors
    expect(intent.actors.length).toBeGreaterThanOrEqual(1);
    // Should detect objects
    expect(intent.objects.length).toBeGreaterThanOrEqual(1);
    // Should detect actions
    expect(intent.actions).toContain("search");
  });

  it("Phase GP.2: DNA Descriptor generates World Definition (NOT hardcoded domain)", async () => {
    const engine = getIntentEngine();
    const intent = await engine.parse(goal);

    const descriptor = getDNADescriptor();
    const world = await descriptor.generate(intent, { useLLM: false, fallbackToPattern: true });

    expect(world).toBeDefined();

    // Validate schema
    const validation = validateWorldDNA(world);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Must have generic entities (not furniture-specific)
    const entityNames = world.entities.map(e => e.name);
    expect(entityNames).toContain("Listing");
    expect(entityNames).toContain("User");
    expect(entityNames).toContain("Offer");
    expect(entityNames).toContain("Transaction");
    expect(entityNames).toContain("Message");

    // Listing entity should be generic (not "FurnitureListing")
    const listing = world.entities.find(e => e.name === "Listing");
    expect(listing).toBeDefined();
    expect(listing!.fields.some(f => f.name === "condition")).toBe(true); // generic condition field
    expect(listing!.fields.some(f => f.name === "price")).toBe(true); // generic price field
    expect(listing!.fields.some(f => f.name === "category")).toBe(true); // generic category field

    // Must NOT have hardcoded furniture-specific fields
    const fieldNames = listing!.fields.map(f => f.name);
    expect(fieldNames).not.toContain("woodType");
    expect(fieldNames).not.toContain("furnitureBrand");

    // Must have capabilities bound to generic primitives
    const capIds = world.capabilities.map(c => c.capabilityId);
    expect(capIds).toContain("generic.CREATE");
    expect(capIds).toContain("generic.SEARCH");
    expect(capIds).toContain("generic.FILTER");
    expect(capIds).toContain("generic.COMPARE");
  });

  it("Phase GP.3: Capability Resolver binds generic capabilities to world entities", async () => {
    const engine = getIntentEngine();
    const descriptor = getDNADescriptor();
    const intent = await engine.parse(goal);
    const world = await descriptor.generate(intent, { useLLM: false, fallbackToPattern: true });

    // Patch registry to avoid DB dependency
    const { capabilityRegistry } = await import("../../api/core/capability-registry");
    const originalGetByName = capabilityRegistry.getByName.bind(capabilityRegistry);
    capabilityRegistry.getByName = vi.fn(async (name: string) => ({
      id: 1, name, description: "Mock", version: "1.0.0",
      inputSchema: {}, outputSchema: {}, requirements: [], permissions: [],
      riskLevel: "low", sideEffects: [], executionHandler: "mock",
      validationRules: [], metadata: {}, isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    }));

    const resolver = new CapabilityResolver();
    const capabilities = await resolver.resolve(world);

    // Restore
    capabilityRegistry.getByName = originalGetByName;

    expect(capabilities.length).toBeGreaterThan(0);

    // Each resolved capability should have a target entity
    for (const cap of capabilities) {
      expect(cap.metadata?.targetEntity).toBeDefined();
      expect(typeof cap.metadata?.targetEntity).toBe("string");
    }

    // Should have CREATE for Listing
    const createListing = capabilities.find(c =>
      c.id.includes("CREATE") && c.metadata?.targetEntity === "listing"
    );
    expect(createListing).toBeDefined();
  });

  it("Phase GP.4: Planner generates valid Execution Plan (DAG)", async () => {
    const engine = getIntentEngine();
    const descriptor = getDNADescriptor();
    const planner = getGenerativePlanner();

    const intent = await engine.parse(goal);
    const world = await descriptor.generate(intent, { useLLM: false, fallbackToPattern: true });
    const resolver = new CapabilityResolver();
    const capabilities = await resolver.resolve(world);

    const plan = await planner.plan(intent, world, capabilities);

    expect(plan).toBeDefined();

    // Validate plan schema
    const validation = validateExecutionPlan(plan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Must have steps
    expect(plan.steps.length).toBeGreaterThan(0);

    // All steps must reference valid capabilities
    for (const step of plan.steps) {
      expect(step.capabilityId).toBeDefined();
      expect(step.id).toBeDefined();
      expect(step.name).toBeDefined();
    }

    // DAG must have no cycles (validated by validateExecutionPlan)
  });

  it("Phase GP.5: Generative Runtime executes goal end-to-end", async () => {
    const runtime = getGenerativeRuntime({ useLLM: false, enableVerification: true, enableRepair: true });
    let result: any;
    try {
      result = await runtime.executeGoal(goal);
    } catch (err: any) {
      console.log("[TEST DEBUG] GP.5 THREW:", err?.message || String(err), err?.stack);
      throw err;
    }
    if (!result.success) {
      console.log("[TEST DEBUG] GP.5 error:", result.error);
      console.log("[TEST DEBUG] result keys:", Object.keys(result));
    }

    expect(result.success).toBe(true);
    expect(result.intent).toBeDefined();
    expect(result.world).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.uiContract).toBeDefined();
    expect(result.durationMs).toBeGreaterThan(0);

    // World must be valid
    const worldValidation = validateWorldDNA(result.world!);
    expect(worldValidation.valid).toBe(true);

    // Plan must be valid
    const planValidation = validateExecutionPlan(result.plan!);
    expect(planValidation.valid).toBe(true);

    // UI Contract must have screens
    expect(result.uiContract!.screens.length).toBeGreaterThan(0);
    expect(result.uiContract!.status).toBe("ready");
  });

  it("Phase GP.6: UI Contract is generated from World DNA (not hardcoded)", async () => {
    const engine = getIntentEngine();
    const descriptor = getDNADescriptor();
    const uiGen = getUIContractGenerator();

    const intent = await engine.parse(goal);
    const world = await descriptor.generate(intent, { useLLM: false, fallbackToPattern: true });

    const contract = uiGen.generate(world);

    expect(contract.screens.length).toBeGreaterThan(0);
    expect(contract.theme).toBeDefined();

    // Screens should reference world entities (not hardcoded furniture components)
    for (const screen of contract.screens) {
      if (screen.entityId) {
        const entityExists = world.entities.some(e => e.id === screen.entityId);
        expect(entityExists).toBe(true);
      }
    }

    // Must have search screen
    const searchScreen = contract.screens.find(s => s.type === "search");
    expect(searchScreen).toBeDefined();
  });
});

describe("Novel Task: Tool Lending Between Neighbors", () => {
  const goal = "أريد منصة لاستعارة الأدوات بين الجيران في نفس الحي";

  it("Phase NT.1: Intent Engine detects lending domain (not marketplace)", async () => {
    const engine = getIntentEngine();
    const intent = await engine.parse(goal);

    expect(intent.domainHints).toContain("lending");
    expect(intent.domainHints).not.toContain("marketplace");
  });

  it("Phase NT.2: DNA Descriptor generates DIFFERENT world (not marketplace clone)", async () => {
    const engine = getIntentEngine();
    const descriptor = getDNADescriptor();

    const intent = await engine.parse(goal);
    const world = await descriptor.generate(intent, { useLLM: false, fallbackToPattern: true });

    // Must have Tool entity (not Listing)
    const entityNames = world.entities.map(e => e.name);
    expect(entityNames).toContain("ToolItem");
    expect(entityNames).toContain("BorrowRequest");

    // Must NOT have Offer entity (lending doesn't use offers)
    expect(entityNames).not.toContain("Offer");

    // Must have lending-specific lifecycle
    const tool = world.entities.find(e => e.name === "ToolItem");
    expect(tool!.fields.some(f => f.name === "availability")).toBe(true);

    const borrowRequest = world.entities.find(e => e.name === "BorrowRequest");
    expect(borrowRequest!.lifecycle!.states).toContain("approved");
    expect(borrowRequest!.lifecycle!.states).toContain("returned");
  });

  it("Phase NT.3: Full runtime execution for novel task succeeds", async () => {
    const runtime = getGenerativeRuntime({ useLLM: false });
    const result = await runtime.executeGoal(goal);

    expect(result.success).toBe(true);
    expect(result.world).toBeDefined();

    const world = result.world!;
    const entityNames = world.entities.map(e => e.name);

    // Verify this is a lending world, not marketplace
    expect(entityNames).toContain("ToolItem");
    expect(entityNames).toContain("BorrowRequest");
    expect(entityNames).not.toContain("Offer");
    expect(entityNames).not.toContain("Transaction");

    // UI should reflect lending
    const searchScreen = result.uiContract!.screens.find(s => s.type === "search");
    expect(searchScreen).toBeDefined();
    expect(searchScreen!.entityId).toBe("tool");
  });
});

describe("Security: No eval() in generated code", () => {
  it("Generated plans do not contain eval or Function constructor", async () => {
    const runtime = getGenerativeRuntime({ useLLM: false });
    const result = await runtime.executeGoal("أريد سوقاً لبيع الكتب المستعملة");
    if (!result.success) console.log("[TEST DEBUG] Security error:", result.error);

    expect(result.success).toBe(true);

    // Serialize and check for eval
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('eval(');
    expect(serialized).not.toContain('Function("');
    expect(serialized).not.toContain('new Function');
  });
});
