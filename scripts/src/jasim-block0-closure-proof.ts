import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function mustThrow(action: () => Promise<unknown>, label: string): Promise<string> {
  try {
    const result = await action();
    throw new Error(`${label} returned ${JSON.stringify(result)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes(" returned ")) throw error;
    return error instanceof Error ? error.message : String(error);
  }
}

type EffectMode = "EFFECT_OCCURRED" | "EFFECT_NOT_OCCURRED";

type EffectState = {
  calls: number;
  callsByKey: Map<string, number>;
  providerResults: Map<string, Record<string, unknown>>;
};

function createEffectState(): EffectState {
  return {
    calls: 0,
    callsByKey: new Map(),
    providerResults: new Map(),
  };
}

async function run() {
  const registryUrl = pathToFileURL(
    path.resolve(process.cwd(), "../canonical/جاسم/app/api/runtime/capability-registry.ts"),
  ).href;
  const runtimeUrl = pathToFileURL(
    path.resolve(process.cwd(), "../canonical/جاسم/app/api/runtime/jasim-runtime.ts"),
  ).href;

  const registryModule = await import(registryUrl) as {
    CapabilityRegistry: new (options?: {
      allowTestOnly?: boolean;
      allowedTestCapabilityIds?: ReadonlySet<string>;
    }) => {
      register(capability: {
        id: string;
        aliases: string[];
        risk: "high";
        sideEffects: "local_test";
        testOnly: true;
        inputContract: { requiredKeys: string[] };
        execute(inputs: Record<string, unknown>, context: {
          idempotencyKey: string;
          attemptId?: string;
        }): Promise<Record<string, unknown>>;
      }): void;
      executeTrusted(
        capabilityId: string,
        inputs: Record<string, unknown>,
        context: Record<string, unknown>,
      ): Promise<Record<string, unknown>>;
    };
    hasTrustedCapability(name: string): boolean;
    executeTrustedCapability(input: {
      capabilityId: string;
      inputs: Record<string, unknown>;
      context: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };

  const runtime = await import(runtimeUrl) as {
    createRuntimeConversation(input: { ownerId: string; title: string }): Promise<{ id: string }>;
    createRuntimeMessage(input: {
      ownerId: string;
      conversationId: string;
      role: "user";
      content: string;
    }): Promise<{ id: string }>;
    createRuntimeRun(input: {
      ownerId: string;
      conversationId: string;
      goal: string;
      idempotencyKey: string;
      status: "blocked";
      requiredCapabilities: string[];
    }): Promise<{ id: string; status: string }>;
    createExecutionProposal(input: {
      ownerId: string;
      conversationId: string;
      runId: string;
      sourceMessageId: string;
      intentType: "direct_action";
      capability: string;
      inputs: Record<string, unknown>;
      missingInputs: string[];
      risk: "high";
      targetReferences: [];
      referenceResolution: { status: "not_requested"; references: [] };
      capabilityRegistry?: InstanceType<typeof registryModule.CapabilityRegistry>;
    }): Promise<{ id: string; status: string; fingerprint: string }>;
    decideExecutionProposalApproval(input: {
      ownerId: string;
      proposalId: string;
      decision: "approve";
    }): Promise<{ id: string; status: string }>;
    resumeApprovedPlan(proposalId: string, ownerId: string): Promise<{ id: string; status: string }>;
    materializeApprovedRunDag(
      runId: string,
      ownerId: string,
      capabilityRegistry?: InstanceType<typeof registryModule.CapabilityRegistry>,
    ): Promise<{ id: string; status: string }>;
    executeRuntimeDagNode(input: {
      ownerId: string;
      runId: string;
      workerId: string;
      capabilityExecutor?: (input: {
        capabilityId: string;
        inputs: Record<string, unknown>;
        context: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>;
      capabilityRegistry?: InstanceType<typeof registryModule.CapabilityRegistry>;
      simulateCrashAfterCapability?: boolean;
    }): Promise<unknown>;
    getRuntimeRun(runId: string, ownerId: string): Promise<{
      status: string;
      dag: Array<{ id: string; status: string }>;
    }>;
    listNodeExecutionAttempts(nodeId: string, ownerId: string): Promise<Array<{
      id: string;
      idempotencyKey: string;
      executionStatus: string;
      verificationStatus: string;
    }>>;
    reconcileUncertainAttempt(
      attemptId: string,
      ownerId: string,
      lookup?: (input: {
        attempt: { idempotencyKey: string };
        node: unknown;
      }) => Promise<
        | { outcome: "occurred"; result: Record<string, unknown>; notes?: string[] }
        | { outcome: "not_occurred"; notes?: string[] }
      >,
      capabilityRegistry?: InstanceType<typeof registryModule.CapabilityRegistry>,
    ): Promise<{ status: string }>;
  };

  const OWNER_A = "1";
  const OWNER_B = "2";
  const capabilityId = "test-local-effect";

  function createTestRegistry(state: EffectState, mode: EffectMode) {
    const registry = new registryModule.CapabilityRegistry({
      allowTestOnly: true,
      allowedTestCapabilityIds: new Set([capabilityId]),
    });
    registry.register({
      id: capabilityId,
      aliases: [],
      risk: "high",
      sideEffects: "local_test",
      testOnly: true,
      inputContract: { requiredKeys: ["value"] },
      execute: async (inputs, context) => {
        const key = context.idempotencyKey;
        state.calls += 1;
        state.callsByKey.set(key, (state.callsByKey.get(key) ?? 0) + 1);
        const output = {
          kind: "test-local-effect",
          value: inputs.value,
          providerKey: key,
          attemptId: context.attemptId ?? null,
        };
        if (mode === "EFFECT_OCCURRED") {
          state.providerResults.set(key, {
            result: output,
            metadata: { capabilityId, kind: "test-local-effect" },
          });
        }
        return output;
      },
    });
    return registry;
  }

  const productionRegistry = new registryModule.CapabilityRegistry();
  const productionRegistrationError = await mustThrow(
    async () => {
      productionRegistry.register({
        id: capabilityId,
        aliases: [],
        risk: "high",
        sideEffects: "local_test",
        testOnly: true,
        inputContract: { requiredKeys: ["value"] },
        execute: async () => ({ kind: "never" }),
      });
    },
    "production registration of a local test effect",
  );
  assert(productionRegistrationError.includes("not allowed"), "Production registry accepted a test effect.");
  assert(!registryModule.hasTrustedCapability(capabilityId), "Test capability leaked into production registry.");
  await mustThrow(
    () => registryModule.executeTrustedCapability({
      capabilityId,
      inputs: { value: "bypass" },
      context: {},
    }),
    "direct production capability bypass",
  );
  console.log("PASS DIRECT_EFFECTFUL_PROVIDER_BYPASS=0 CLIENT_DIRECT_EFFECT=0");

  async function createApprovedRun(state: EffectState, mode: EffectMode, value: string) {
    const registry = createTestRegistry(state, mode);
    const conversation = await runtime.createRuntimeConversation({
      ownerId: OWNER_A,
      title: "Block 0 controlled local effect",
    });
    const message = await runtime.createRuntimeMessage({
      ownerId: OWNER_A,
      conversationId: conversation.id,
      role: "user",
      content: "Execute the controlled local effect.",
    });
    const run = await runtime.createRuntimeRun({
      ownerId: OWNER_A,
      conversationId: conversation.id,
      goal: "Controlled local effect recovery proof",
      idempotencyKey: `block0-effect-${randomUUID()}`,
      status: "blocked",
      requiredCapabilities: [capabilityId],
    });
    const proposal = await runtime.createExecutionProposal({
      ownerId: OWNER_A,
      conversationId: conversation.id,
      runId: run.id,
      sourceMessageId: message.id,
      intentType: "direct_action",
      capability: capabilityId,
      inputs: { value },
      missingInputs: [],
      risk: "high",
      targetReferences: [],
      referenceResolution: { status: "not_requested", references: [] },
      capabilityRegistry: registry,
    });
    assert(proposal.status === "awaiting_approval", "Controlled effect must require approval.");
    await mustThrow(
      () => runtime.materializeApprovedRunDag(run.id, OWNER_A, registry),
      "materialization before controlled-effect approval",
    );
    assert(state.calls === 0, "Proposal or denied materialization called the effect adapter.");
    await mustThrow(
      () => runtime.decideExecutionProposalApproval({
        ownerId: OWNER_B,
        proposalId: proposal.id,
        decision: "approve",
      }),
      "cross-owner approval",
    );
    await runtime.decideExecutionProposalApproval({
      ownerId: OWNER_A,
      proposalId: proposal.id,
      decision: "approve",
    });
    await runtime.resumeApprovedPlan(proposal.id, OWNER_A);
    await runtime.materializeApprovedRunDag(run.id, OWNER_A, registry);
    const materialized = await runtime.getRuntimeRun(run.id, OWNER_A);
    assert(materialized.dag.length === 1, "Approved controlled effect must materialize exactly one DAG node.");
    assert(
      materialized.dag[0]?.status === "READY",
      `Approved controlled effect node must be READY, got ${materialized.dag[0]?.status ?? "missing"}.`,
    );
    return { registry, runId: run.id, proposalId: proposal.id };
  }

  const occurred = createEffectState();
  const occurredRun = await createApprovedRun(occurred, "EFFECT_OCCURRED", "occurred");
  const executeOccurred = (input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    context: Record<string, unknown>;
  }) => occurredRun.registry.executeTrusted(input.capabilityId, input.inputs, input.context);
  const crashError = await mustThrow(
    () => runtime.executeRuntimeDagNode({
      ownerId: OWNER_A,
      runId: occurredRun.runId,
      workerId: "block0-effect-worker",
      capabilityExecutor: executeOccurred,
      capabilityRegistry: occurredRun.registry,
      simulateCrashAfterCapability: true,
    }),
    "simulated process crash after local effect",
  );
  assert(crashError.includes("SIMULATED_PROCESS_CRASH"), "Crash simulation finalized an effect instead of preserving uncertainty.");
  assert(occurred.calls === 1, "Occurred effect was not called exactly once before restart.");
  const crashedRun = await runtime.getRuntimeRun(occurredRun.runId, OWNER_A);
  const crashedNode = crashedRun.dag[0];
  assert(crashedNode?.status === "RUNNING", "Crash simulation must preserve a running node for restart recovery.");
  const [uncertainAttempt] = await runtime.listNodeExecutionAttempts(crashedNode.id, OWNER_A);
  assert(uncertainAttempt?.executionStatus === "RUNNING", "Crash simulation must preserve a RUNNING attempt.");

  // Recreate the test registry to model a new runtime process. The provider-side
  // state is external to the runtime and remains queryable by idempotency key.
  const restartedOccurredRegistry = createTestRegistry(occurred, "EFFECT_OCCURRED");
  const occurredVerification = await runtime.reconcileUncertainAttempt(
    uncertainAttempt.id,
    OWNER_A,
    async ({ attempt }) => {
      const result = occurred.providerResults.get(attempt.idempotencyKey);
      return result
        ? { outcome: "occurred", result, notes: ["provider-side idempotency lookup found the effect"] }
        : { outcome: "not_occurred", notes: ["provider-side lookup did not find an effect"] };
    },
    restartedOccurredRegistry,
  );
  assert(occurredVerification.status === "VERIFIED", "Occurred effect must reconcile to VERIFIED.");
  const occurredFinal = await runtime.getRuntimeRun(occurredRun.runId, OWNER_A);
  assert(occurredFinal.status === "completed", "Occurred effect must complete the canonical run after reconciliation.");
  assert(occurred.calls === 1, "Restart reconciliation retried an effect that already occurred.");
  await runtime.executeRuntimeDagNode({
    ownerId: OWNER_A,
    runId: occurredRun.runId,
    workerId: "block0-effect-worker-retry",
    capabilityExecutor: executeOccurred,
    capabilityRegistry: occurredRun.registry,
  });
  assert(occurred.calls === 1, "Completed run re-executed the provider effect.");
  console.log("PASS EFFECTFUL_RECOVERY_EFFECT_OCCURRED PROVIDER_EFFECT_CALL_COUNT=1 BLIND_EFFECT_RETRY_AFTER_RESTART=0");

  const absent = createEffectState();
  const absentRun = await createApprovedRun(absent, "EFFECT_NOT_OCCURRED", "absent");
  const executeAbsent = (input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    context: Record<string, unknown>;
  }) => absentRun.registry.executeTrusted(input.capabilityId, input.inputs, input.context);
  await mustThrow(
    () => runtime.executeRuntimeDagNode({
      ownerId: OWNER_A,
      runId: absentRun.runId,
      workerId: "block0-absent-worker",
      capabilityExecutor: executeAbsent,
      capabilityRegistry: absentRun.registry,
      simulateCrashAfterCapability: true,
    }),
    "simulated crash without provider effect",
  );
  const absentCrashed = await runtime.getRuntimeRun(absentRun.runId, OWNER_A);
  const [absentAttempt] = await runtime.listNodeExecutionAttempts(absentCrashed.dag[0].id, OWNER_A);
  const absentVerification = await runtime.reconcileUncertainAttempt(
    absentAttempt.id,
    OWNER_A,
    async () => ({ outcome: "not_occurred", notes: ["provider-side lookup proved absence"] }),
    absentRun.registry,
  );
  assert(absentVerification.status === "FAILED", "Absent effect must reconcile to FAILED.");
  const absentFinal = await runtime.getRuntimeRun(absentRun.runId, OWNER_A);
  assert(
    absentFinal.dag[0]?.status === "RETRY_SCHEDULED",
    "Retry must become eligible only after reconciliation proved no effect.",
  );
  assert(absent.calls === 1, "Absent-effect reconciliation performed a blind retry.");
  console.log("PASS EFFECTFUL_RECOVERY_EFFECT_NOT_OCCURRED PROVIDER_EFFECT_CALL_COUNT=1");

  const generatedCapabilityBlocked = await mustThrow(
    () => registryModule.executeTrustedCapability({
      capabilityId: "execute-arbitrary-code",
      inputs: { code: "forged provider call" },
      context: {},
    }),
    "generated unregistered capability",
  );
  assert(generatedCapabilityBlocked.length > 0, "Generated unregistered capability was not rejected.");

  const staleState = createEffectState();
  const staleRegistry = createTestRegistry(staleState, "EFFECT_OCCURRED");
  const staleConversation = await runtime.createRuntimeConversation({ ownerId: OWNER_A, title: "Stale approval proof" });
  const staleMessage = await runtime.createRuntimeMessage({
    ownerId: OWNER_A,
    conversationId: staleConversation.id,
    role: "user",
    content: "versioned controlled effect",
  });
  const staleRun = await runtime.createRuntimeRun({
    ownerId: OWNER_A,
    conversationId: staleConversation.id,
    goal: "Reject stale approval",
    idempotencyKey: `block0-stale-${randomUUID()}`,
    status: "blocked",
    requiredCapabilities: [capabilityId],
  });
  const proposalInput = (value: string) => ({
    ownerId: OWNER_A,
    conversationId: staleConversation.id,
    runId: staleRun.id,
    sourceMessageId: staleMessage.id,
    intentType: "direct_action" as const,
    capability: capabilityId,
    inputs: { value },
    missingInputs: [],
    risk: "high" as const,
    targetReferences: [] as [],
    referenceResolution: { status: "not_requested" as const, references: [] as [] },
    capabilityRegistry: staleRegistry,
  });
  const v1 = await runtime.createExecutionProposal(proposalInput("v1"));
  await runtime.decideExecutionProposalApproval({ ownerId: OWNER_A, proposalId: v1.id, decision: "approve" });
  await runtime.createExecutionProposal(proposalInput("v2"));
  await mustThrow(
    () => runtime.resumeApprovedPlan(v1.id, OWNER_A),
    "stale approval replay after proposal version change",
  );
  console.log("PASS GENERATED_EXECUTION_PRIVILEGE=0 CROSS_CONTEXT_APPROVAL_REPLAY=0 STALE_APPROVAL_EXECUTION=0");

  console.log("BLOCK0_CLOSURE_PROOF=PASS");
}

run().catch((error) => {
  console.error("BLOCK0_CLOSURE_PROOF=FAIL", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});