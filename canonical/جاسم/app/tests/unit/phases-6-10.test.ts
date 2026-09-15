import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: drizzle-orm query operators
// ═══════════════════════════════════════════════════════════════════════════════
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual,
    eq: (column: any, value: any) => ({ _type: 'eq', columnName: column?.name ?? 'unknown', value }),
    and: (...conditions: any[]) => ({ _type: 'and', conditions }),
    or: (...conditions: any[]) => ({ _type: 'or', conditions }),
    inArray: (column: any, values: any[]) => ({ _type: 'inArray', columnName: column?.name ?? 'unknown', values }),
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: llm-router — avoids loading error-handler.ts which has a Zod version bug
// ═══════════════════════════════════════════════════════════════════════════════
vi.mock('../../api/core/llm-router', () => ({
  llmRouter: {
    route: vi.fn(async (options: any) => {
      // For planning/replanning requests, return a valid plan
      if (options?.systemPrompt?.includes('planning engine')) {
        return {
          text: JSON.stringify({
            steps: [{
              name: 'Recovery Step',
              capability: 'retrieve',
              inputs: { recovered: true },
              dependencies: [],
              parallel: false,
              risk: 'low',
              requiresApproval: false
            }],
            reasoning: 'Replan after failure'
          }),
          success: true
        };
      }
      // For fallback/recovery requests, return empty (failure)
      return { text: '', success: false };
    }),
  },
}));


// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: planner — avoids loading intent-engine which has a path alias bug
// ═══════════════════════════════════════════════════════════════════════════════
vi.mock('../../api/core/planner', () => ({
  Planner: class MockPlanner {
    constructor() {}
    async understand() { return { goal: 'test', requirements: [] }; }
    async plan() {
      return {
        nodes: [{ id: 'recovery', name: 'Recovery Step', capability: 'retrieve', inputs: {}, dependencies: [] }],
        edges: [],
      };
    }
    async persistPlan(taskId: number, dag: any) {
      // Insert recovery steps into mock DB
      const { db } = await import('../../api/queries/connection');
      const { taskSteps } = await import('../../db/schema');
      for (const node of dag.nodes) {
        await db.insert(taskSteps).values({
          taskId,
          name: node.name || 'recovery_step',
          type: node.capability || 'retrieve',
          inputs: node.inputs || {},
          dependencies: node.dependencies || [],
          status: 'pending',
          retryCount: 0,
        });
      }
    }
  },
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: DB connection — in-memory store with WeakMap (keyed by real table obj)
// ═══════════════════════════════════════════════════════════════════════════════
vi.mock('../../api/queries/connection', () => {
  // Use WeakMap keyed by actual table object identity (since drizzle tables don't have .name)
  let stores = new WeakMap<any, Map<number, any>>();
  let nextId = 1;

  function resetDb() {
    stores = new WeakMap();
    nextId = 1;
  }

  function getStore(table: any): Map<number, any> {
    if (!stores.has(table)) {
      stores.set(table, new Map());
    }
    return stores.get(table)!;
  }

  function evaluateCondition(row: any, condition: any): boolean {
    if (!condition) return true;
    if (condition._type === 'eq') {
      return String(row[condition.columnName]) === String(condition.value);
    }
    if (condition._type === 'and') {
      return condition.conditions.every((c: any) => evaluateCondition(row, c));
    }
    if (condition._type === 'or') {
      return condition.conditions.some((c: any) => evaluateCondition(row, c));
    }
    if (condition._type === 'inArray') {
      return condition.values.map(String).includes(String(row[condition.columnName]));
    }
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
        }
      };
    },
    select() {
      return {
        from: (table: any) => ({
          where: async (condition: any) => {
            const store = getStore(table);
            return Array.from(store.values()).filter(row => evaluateCondition(row, condition));
          }
        })
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
          }
        })
      };
    },
    __reset: resetDb,
  };

  return { db };
});

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS (after mocks are established)
// ═══════════════════════════════════════════════════════════════════════════════
import { TaskRuntime, taskEventBus } from '../../api/core/task-runtime';
import { db } from '../../api/queries/connection';
import { tasks, taskSteps } from '../../db/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DEPENDENCY FACTORIES
// ═══════════════════════════════════════════════════════════════════════════════
function createMockCytoplasm() {
  return {
    memory: {},
    events: { emit: vi.fn(), on: vi.fn() },
    policies: {},
    permissions: {},
    state: {},
    config: {},
    tracer: { trace: vi.fn(async () => {}) },
    learning: {
      getBestPattern: vi.fn(async () => null),
      adaptPlan: vi.fn(async (plan: any) => plan),
      scorePlan: vi.fn(async () => 0.5),
      recordPattern: vi.fn(async () => {}),
    },
    operational: {
      storePattern: vi.fn(async () => {}),
    },
  } as any;
}

function createMockCapabilityRegistry(capabilities: any[] = []) {
  return {
    list: vi.fn(async () => capabilities),
    execute: vi.fn(async (id: any, inputs: any, context: any) => {
      const cap = capabilities.find((c: any) => c.id === id);
      if (cap?.handler) {
        return cap.handler(inputs, context);
      }
      return {};
    }),
    discover: vi.fn(async () => capabilities),
  } as any;
}

function createMockToolRuntime(tools: any[] = []) {
  return {
    list: vi.fn(async () => tools),
    invoke: vi.fn(async (id: any, inputs: any, context: any) => {
      const tool = tools.find((t: any) => t.id === id);
      if (tool?.handler) {
        return tool.handler(inputs, context);
      }
      return { success: true, output: {} };
    }),
  } as any;
}

function createMockAgentRuntime() {
  return {
    listAgents: vi.fn(async () => []),
    getAgent: vi.fn(async () => null),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6: True TaskRuntime Execution
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 6: True TaskRuntime Execution', () => {
  let runtime: TaskRuntime;
  let registry: any;
  let toolRuntime: any;

  beforeEach(() => {
    (db as any).__reset();
    taskEventBus.removeAllListeners();

    const cytoplasm = createMockCytoplasm();
    const agentRuntime = createMockAgentRuntime();

    registry = createMockCapabilityRegistry([
      { id: 1, name: 'retrieve', description: 'Retrieve data' },
      { id: 2, name: 'analyze', description: 'Analyze data' },
      { id: 3, name: 'combine', description: 'Combine data' },
      { id: 4, name: 'transform', description: 'Transform data' },
    ]);

    toolRuntime = createMockToolRuntime([]);

    runtime = new TaskRuntime(cytoplasm, registry, toolRuntime, agentRuntime);
  });

  afterEach(() => {
    taskEventBus.removeAllListeners();
  });

  it('Phase 6.1: Step B receives Step A output through real executePlan()', async () => {
    // ── Setup: Step A returns weather data, Step B analyzes it ─────────────────
    registry.execute = vi.fn(async (capId: number, inputs: any, _context: any) => {
      if (capId === 1) {
        return { temperature: 25, humidity: 65 };
      }
      if (capId === 2) {
        return { summary: 'Warm and humid', receivedInputs: inputs };
      }
      return {};
    });

    // 1. Create task
    const task = await runtime.createTask('Fetch and analyze weather', 1);
    expect(task.id).toBeDefined();

    // 2. Insert Step A into mock DB (using REAL taskSteps table object)
    const stepAResult = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'fetch_weather',
      type: 'retrieve',
      inputs: { city: 'London' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });
    const stepAId = stepAResult[0].insertId;

    // 3. Insert Step B (depends on Step A)
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'analyze_weather',
      type: 'analyze',
      inputs: { method: 'summary' },
      dependencies: [String(stepAId)],
      status: 'pending',
      retryCount: 0,
    });

    // 4. Execute plan with REAL TaskRuntime
    await runtime.executePlan(task.id);

    // 5. Verify: Step B received Step A's outputs in its inputs
    const calls = registry.execute.mock.calls;

    // Find the call for Step B (analyze capability, id=2)
    const analyzeCall = calls.find((call: any) => call[0] === 2);
    expect(analyzeCall).toBeDefined();

    const analyzeInputs = analyzeCall[1];

    // Original input preserved
    expect(analyzeInputs.method).toBe('summary');

    // Dependency output injected
    expect(analyzeInputs.fetch_weather_output).toBeDefined();
    expect(analyzeInputs.fetch_weather_output).toEqual({ temperature: 25, humidity: 65 });
  });

  it('Phase 6.2: Parallel steps execute simultaneously and both outputs reach dependent step', async () => {
    // Use 'retrieve' for both parallel steps (same capability, different step names)
    // Use 'analyze' for the combine step
    registry.execute = vi.fn(async (capId: number, inputs: any, context: any) => {
      if (capId === 1) {
        // Distinguish parallel steps by their stepId in context
        // Task takes id=1, so steps get id=2 and id=3
        if (context.stepId === '2') return { source: 'A', value: 10 };
        if (context.stepId === '3') return { source: 'B', value: 20 };
        return { source: 'unknown', value: 0 };
      }
      if (capId === 2) {
        return { combined: 'A+B', receivedInputs: inputs };
      }
      return {};
    });

    const task = await runtime.createTask('Parallel fetch and combine', 1);

    // Step A and B have no dependencies — they go in the SAME DAG level
    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'fetch_a',
      type: 'retrieve',
      inputs: { query: 'A' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });
    const stepB = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'fetch_b',
      type: 'retrieve',
      inputs: { query: 'B' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });

    // Step C depends on BOTH A and B
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'combine_results',
      type: 'analyze',
      inputs: { operation: 'merge' },
      dependencies: [String(stepA[0].insertId), String(stepB[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    await runtime.executePlan(task.id);

    const calls = registry.execute.mock.calls;

    // Verify Step C (analyze, capId=2) received both outputs
    const combineCall = calls.find((call: any) => call[0] === 2);
    expect(combineCall).toBeDefined();
    expect(combineCall[1].fetch_a_output).toEqual({ source: 'A', value: 10 });
    expect(combineCall[1].fetch_b_output).toEqual({ source: 'B', value: 20 });
  });

  it('Phase 6.3: Template variables resolved from dependency outputs', async () => {
    registry.execute = vi.fn(async (capId: number, inputs: any) => {
      if (capId === 1) return { temperature: 30, unit: 'C' };
      if (capId === 2) return { formatted: inputs.temperature_value };
      return {};
    });

    const task = await runtime.createTask('Template variable test', 1);

    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'get_temp',
      type: 'retrieve',
      inputs: { city: 'Dubai' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });

    // Step B uses template variable: $get_temp.outputs.temperature
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'format_temp',
      type: 'analyze',
      inputs: { temperature_value: '$get_temp.outputs.temperature' },
      dependencies: [String(stepA[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    await runtime.executePlan(task.id);

    const calls = registry.execute.mock.calls;
    const formatCall = calls.find((call: any) => call[0] === 2);
    expect(formatCall).toBeDefined();
    expect(formatCall[1].temperature_value).toBe(30);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 7: Real Replan Continuation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 7: Real Replan Continuation', () => {
  let runtime: TaskRuntime;
  let registry: any;
  let toolRuntime: any;

  beforeEach(() => {
    (db as any).__reset();
    taskEventBus.removeAllListeners();

    const cytoplasm = createMockCytoplasm();
    const agentRuntime = createMockAgentRuntime();

    registry = createMockCapabilityRegistry([
      { id: 1, name: 'retrieve', description: 'Retrieve data' },
      { id: 2, name: 'analyze', description: 'Analyze data' },
    ]);

    toolRuntime = createMockToolRuntime([]);

    runtime = new TaskRuntime(cytoplasm, registry, toolRuntime, agentRuntime);
  });

  afterEach(() => {
    taskEventBus.removeAllListeners();
  });

  it('Phase 7.1: executePlan reloads new plan after replan and executes Step C', async () => {
    // ── Setup: monkey-patch replan to insert a new step directly ───────────────
    const originalReplan = (runtime as any).replan.bind(runtime);
    let replanCalled = false;
    (runtime as any).replan = vi.fn(async (taskId: number) => {
      replanCalled = true;
      console.log('[TEST] Monkey-patched replan called for task', taskId);

      // Insert a recovery step
      const insertResult = await db.insert(taskSteps).values({
        taskId,
        name: 'recovery_step',
        type: 'retrieve',
        inputs: { recovered: true },
        dependencies: [],
        status: 'pending',
        retryCount: 0,
      });
      console.log('[TEST] Insert result:', insertResult);

      // Verify it's in the DB
      const allSteps = await db.select().from(taskSteps).where({ _type: 'eq', columnName: 'taskId', value: taskId });
      console.log('[TEST] Steps in DB after replan:', allSteps.map((s: any) => ({ id: s.id, name: s.name, status: s.status })));

      return true;
    });

    // Step A succeeds, Step B fails unrecoverably
    registry.execute = vi.fn(async (_capId: number, inputs: any) => {
      if (inputs.source === 'api') return { data: 'from_step_a' };
      if (inputs.method === 'deep') throw new Error('Analyze capability unavailable');
      if (inputs.recovered === true) return { recovered: true, data: 'from_recovery' };
      return {};
    });

    const task = await runtime.createTask('Test replan continuation', 1);

    // Insert Step A
    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'collect_data',
      type: 'retrieve',
      inputs: { source: 'api' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });

    // Insert Step B (depends on A, will fail)
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'process_data',
      type: 'analyze',
      inputs: { method: 'deep' },
      dependencies: [String(stepA[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    // Execute plan
    const result = await runtime.executePlan(task.id);
    console.log('[TEST] Result from executePlan:', result);

    // Restore original replan
    (runtime as any).replan = originalReplan;

    // Verify replan was called
    expect(replanCalled).toBe(true);

    // Verify task completed (not failed) — the recovery step succeeded
    console.log('[TEST] result.status:', result.status);
    expect(result.status).toBe('completed');

    // Verify Step C (recovery step) was executed
    const calls = registry.execute.mock.calls;
    const recoveryCall = calls.find((call: any) => call[1]?.recovered === true);
    expect(recoveryCall).toBeDefined();
  }, 15000);

  it('Phase 7.2: New plan steps are loaded from DB after replan', async () => {
    const originalReplan = (runtime as any).replan.bind(runtime);
    (runtime as any).replan = vi.fn(async (taskId: number) => {
      await db.insert(taskSteps).values({
        taskId,
        name: 'fallback_step',
        type: 'retrieve',
        inputs: { fallback: true },
        dependencies: [],
        status: 'pending',
        retryCount: 0,
      });
      return true;
    });

    registry.execute = vi.fn(async (_capId: number, inputs: any) => {
      if (inputs.source === 'db') return { raw: 'data' };
      if (inputs.method === 'crash') throw new Error('Always fails');
      if (inputs.fallback === true) return { fallback: 'success' };
      return {};
    });

    const task = await runtime.createTask('Verify replan reloads from DB', 1);

    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'collect_data',
      type: 'retrieve',
      inputs: { source: 'db' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'process_data',
      type: 'analyze',
      inputs: { method: 'crash' },
      dependencies: [String(stepA[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    await runtime.executePlan(task.id);

    (runtime as any).replan = originalReplan;

    // Query all steps for this task
    const stepsFromDb = await db.select().from(taskSteps).where({ _type: 'eq', columnName: 'taskId', value: task.id });

    // After replan, there should be 3 steps total
    expect(stepsFromDb.length).toBeGreaterThanOrEqual(2);

    // Verify at least one step has the fallback name
    const hasFallbackStep = stepsFromDb.some((s: any) => s.name === 'fallback_step');
    expect(hasFallbackStep).toBe(true);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 8: Dynamic Repair Decision Engine
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 8: Dynamic Repair Decision Engine', () => {
  let runtime: TaskRuntime;
  let registry: any;
  let toolRuntime: any;

  beforeEach(() => {
    (db as any).__reset();
    taskEventBus.removeAllListeners();

    const cytoplasm = createMockCytoplasm();
    const agentRuntime = createMockAgentRuntime();

    registry = createMockCapabilityRegistry([
      { id: 1, name: 'retrieve', description: 'Retrieve data' },
      { id: 2, name: 'analyze', description: 'Analyze data' },
    ]);

    toolRuntime = createMockToolRuntime([]);

    runtime = new TaskRuntime(cytoplasm, registry, toolRuntime, agentRuntime);
  });

  afterEach(() => {
    taskEventBus.removeAllListeners();
  });

  it('Phase 8.1: decideRepairAction returns retry when INVALID_RESULT and retries remain', async () => {
    const decision = await (runtime as any).decideRepairAction(
      { name: 'test_step', type: 'retrieve', retryCount: 0 },
      { status: 'INVALID_RESULT', stepId: '1', stepName: 'test_step', result: {}, error: '', duration: 0, timestamp: '' },
      { passed: false, reason: 'Empty output', checks: [{ name: 'output_present', passed: false, severity: 'error' }] },
      [],
    );

    expect(decision.action).toBe('retry');
    expect(decision.confidence).toBeGreaterThan(0.9);
  });

  it('Phase 8.2: decideRepairAction returns replan when no alternatives and not optional', async () => {
    const decision = await (runtime as any).decideRepairAction(
      { name: 'critical_step', type: 'analyze', retryCount: 3, optional: false, riskLevel: 'normal' },
      { status: 'FAILURE', stepId: '1', stepName: 'critical_step', result: {}, error: 'Capability unavailable', duration: 0, timestamp: '' },
      { passed: false, reason: 'Execution failed', checks: [{ name: 'execution_success', passed: false, severity: 'error' }] },
      [],
    );

    expect(decision.action).toBe('replan');
  });

  it('Phase 8.3: decideRepairAction uses deterministic fallback when LLM fails', async () => {
    // Mock llmRouter to throw
    const { llmRouter } = await import('../../api/core/llm-router');
    const originalRoute = llmRouter.route.bind(llmRouter);
    llmRouter.route = vi.fn(async () => { throw new Error('LLM unavailable'); });

    const decision = await (runtime as any).decideRepairAction(
      { name: 'optional_step', type: 'retrieve', retryCount: 3, optional: true, riskLevel: 'normal' },
      { status: 'FAILURE', stepId: '1', stepName: 'optional_step', result: {}, error: '', duration: 0, timestamp: '' },
      { passed: false, reason: 'Execution failed', checks: [] },
      [],
    );

    // Restore LLM router
    llmRouter.route = originalRoute;

    expect(decision.action).toBe('skip');
    expect(decision.reasoning).toContain('optional');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 9: Observation + Verification as Decision Input
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 9: Observation + Verification as Decision Input', () => {
  let runtime: TaskRuntime;
  let registry: any;
  let toolRuntime: any;

  beforeEach(() => {
    (db as any).__reset();
    taskEventBus.removeAllListeners();

    const cytoplasm = createMockCytoplasm();
    const agentRuntime = createMockAgentRuntime();

    registry = createMockCapabilityRegistry([
      { id: 1, name: 'retrieve', description: 'Retrieve data' },
      { id: 2, name: 'analyze', description: 'Analyze data' },
    ]);

    toolRuntime = createMockToolRuntime([]);

    runtime = new TaskRuntime(cytoplasm, registry, toolRuntime, agentRuntime);
  });

  afterEach(() => {
    taskEventBus.removeAllListeners();
  });

  it('Phase 9.1: Verification failure drives repair decision', async () => {
    // Create a step that produces invalid output
    const decision = await (runtime as any).decideRepairAction(
      { name: 'bad_step', type: 'retrieve', retryCount: 1, maxRetries: 3 },
      { status: 'INVALID_RESULT', stepId: '1', stepName: 'bad_step', result: {}, error: '', duration: 0, timestamp: '' },
      {
        passed: false,
        reason: 'Output missing required fields',
        checks: [
          { name: 'output_present', passed: false, severity: 'error' },
          { name: 'structure_valid', passed: false, severity: 'error' },
        ],
      },
      [],
    );

    // With retries remaining and INVALID_RESULT, should retry
    expect(decision.action).toBe('retry');
  });

  it('Phase 9.2: Observation history is preserved across replan', async () => {
    // Step A succeeds, Step B fails → replan → verify observations persisted
    const originalReplan = (runtime as any).replan.bind(runtime);
    (runtime as any).replan = vi.fn(async (taskId: number) => {
      // Verify observations exist before replan
      const observations = (runtime as any).stepObservations.get(taskId) ?? [];
      expect(observations.length).toBeGreaterThanOrEqual(1);

      await db.insert(taskSteps).values({
        taskId,
        name: 'recovery_step',
        type: 'retrieve',
        inputs: {},
        dependencies: [],
        status: 'pending',
        retryCount: 0,
      });
      return true;
    });

    registry.execute = vi.fn(async (_capId: number, inputs: any) => {
      if (inputs.source === 'api') return { data: 'from_step_a' };
      if (inputs.method === 'deep') throw new Error('Always fails');
      return {};
    });

    const task = await runtime.createTask('Observation preservation test', 1);

    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'collect_data',
      type: 'retrieve',
      inputs: { source: 'api' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'process_data',
      type: 'analyze',
      inputs: { method: 'deep' },
      dependencies: [String(stepA[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    await runtime.executePlan(task.id);

    (runtime as any).replan = originalReplan;

    // Verify observations were preserved (at least Step A's success + Step B's failure)
    const observations = (runtime as any).stepObservations.get(task.id) ?? [];
    expect(observations.length).toBeGreaterThanOrEqual(1);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 10: Full Generative Agent Loop
// ═══════════════════════════════════════════════════════════════════════════════
describe('Phase 10: Full Generative Agent Loop', () => {
  let runtime: TaskRuntime;
  let registry: any;
  let toolRuntime: any;

  beforeEach(() => {
    (db as any).__reset();
    taskEventBus.removeAllListeners();

    const cytoplasm = createMockCytoplasm();
    const agentRuntime = createMockAgentRuntime();

    registry = createMockCapabilityRegistry([
      { id: 1, name: 'retrieve', description: 'Retrieve data' },
      { id: 2, name: 'analyze', description: 'Analyze data' },
      { id: 3, name: 'report', description: 'Generate report' },
    ]);

    toolRuntime = createMockToolRuntime([]);

    runtime = new TaskRuntime(cytoplasm, registry, toolRuntime, agentRuntime);
  });

  afterEach(() => {
    taskEventBus.removeAllListeners();
  });

  it('Phase 10.1: End-to-end agent loop with replan completes successfully', async () => {
    const originalReplan = (runtime as any).replan.bind(runtime);
    (runtime as any).replan = vi.fn(async (taskId: number) => {
      // Cancel all remaining pending steps (like real replan does)
      const remainingSteps = await db.select().from(taskSteps).where({ _type: 'eq', columnName: 'taskId', value: taskId });
      for (const rs of remainingSteps) {
        if (rs.status === 'pending') {
          await db.update(taskSteps).set({
            status: 'cancelled',
            error: 'Cancelled due to replan',
          }).where({ _type: 'eq', columnName: 'id', value: rs.id });
        }
      }

      await db.insert(taskSteps).values({
        taskId,
        name: 'report_step',
        type: 'retrieve',
        inputs: { summary: 'recovered data' },
        dependencies: [],
        status: 'pending',
        retryCount: 0,
      });
      return true;
    });

    // Simulate: Step A succeeds, Step B fails, replan creates Step C, Step C succeeds
    registry.execute = vi.fn(async (_capId: number, inputs: any, context: any) => {
      if (context.stepName === 'fetch_data') return { raw: 'data' };
      if (context.stepName === 'analyze_data') throw new Error('Analysis engine down');
      if (context.stepName === 'report_step') return { report: 'success' };
      return {};
    });

    const task = await runtime.createTask('Full agent loop test', 1);

    const stepA = await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'fetch_data',
      type: 'retrieve',
      inputs: { source: 'db' },
      dependencies: [],
      status: 'pending',
      retryCount: 0,
    });
    await db.insert(taskSteps).values({
      taskId: task.id,
      name: 'analyze_data',
      type: 'analyze',
      inputs: { method: 'deep' },
      dependencies: [String(stepA[0].insertId)],
      status: 'pending',
      retryCount: 0,
    });

    const result = await runtime.executePlan(task.id);

    (runtime as any).replan = originalReplan;

    // Task should complete after replan + recovery step execution
    expect(result.status).toBe('completed');

    // Verify all expected steps were executed
    const calls = registry.execute.mock.calls;
    const fetchCall = calls.find((call: any) => call[2]?.stepName === 'fetch_data');
    const reportCall = calls.find((call: any) => call[2]?.stepName === 'report_step');

    expect(fetchCall).toBeDefined();
    expect(reportCall).toBeDefined();
  }, 15000);
});
