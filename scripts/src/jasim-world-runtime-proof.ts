import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const artifact = {
  taskDNA: {
    objective: "Coordinate a neighborhood repair exchange.",
    summary: "Organize requests, available helpers, and safe matching rules.",
    intentType: "community_coordination",
    actors: ["requester", "helper", "coordinator"],
    objects: [
      {
        name: "repair request",
        type: "request",
        attributes: { urgency: "normal" },
      },
    ],
    actions: ["collect", "analyze", "match"],
    constraints: { communication: "approval-required" },
    requiredCapabilities: ["local-analysis"],
    confidence: 0.91,
    unresolved: ["Which neighborhood and which repair categories should be included?"],
  },
  plan: {
    summary: "Analyze the request and prepare a safe matching proposal.",
    steps: [
      {
        id: "analyze-request",
        name: "Analyze requests",
        description: "Classify the requests without contacting anyone.",
        capability: "local-analysis",
        inputs: { mode: "classification" },
        dependencies: [],
        risk: "low",
        requiresApproval: false,
      },
    ],
  },
  world: {
    name: "Neighborhood Repair Exchange",
    description: "A reusable coordination world for repair requests and helpers.",
    continuity: "evolving",
    participants: [
      { role: "requester", description: "Person asking for repair help." },
      { role: "helper", description: "Person offering a repair skill." },
    ],
    entities: [
      {
        id: "repair-request",
        name: "Repair request",
        type: "request",
        attributes: { status: "open" },
      },
    ],
    capabilities: ["local-analysis"],
    policies: ["Do not contact participants without recorded approval."],
  },
};

const textOutputEnvelope = {
  version: 1,
  decisionId: "00000000-0000-4000-8000-000000000001",
  kind: "text",
  content: "أحتاج تفصيلًا صغيرًا قبل تحويل طلبك إلى عمل دائم.",
  confidence: 0.82,
};

const durableRunOutputEnvelope = {
  version: 1,
  decisionId: "00000000-0000-4000-8000-000000000002",
  kind: "durable_run",
  label: "Price watch",
  goal: "Monitor comparable prices and notify when they decrease.",
  intent: {
    requiredCapabilities: ["external.lookup", "notify.send"],
    missingInputs: [],
    risk: "low",
    persistence: "durable",
    effects: "none",
  },
  confidence: 0.76,
};

const unresolvedRunOutputEnvelope = {
  ...durableRunOutputEnvelope,
  decisionId: "00000000-0000-4000-8000-000000000003",
  label: "Unknown store watch",
  goal: "Monitor an unresolved store reference.",
};

const approvalRunOutputEnvelope = {
  version: 1,
  decisionId: "00000000-0000-4000-8000-000000000004",
  kind: "durable_run",
  label: "High-risk analysis proposal",
  goal: "Prepare a high-risk analysis proposal for review.",
  intent: {
    requiredCapabilities: ["local-analysis"],
    missingInputs: [],
    inputs: { price: 200, currency: "KWD" },
    risk: "high",
    persistence: "durable",
    effects: "none",
  },
  confidence: 0.79,
};

async function main(): Promise<void> {
  process.env.JASIM_MODEL_PROVIDER = "openai-compatible";
  process.env.MODEL_GATEWAY_MODEL = "runtime-proof-model";
  process.env.MODEL_GATEWAY_API_KEY = "runtime-proof-only";
  process.env.MODEL_GATEWAY_BASE_URL = "https://runtime-proof.invalid/v1";
  // Disable fire-and-forget memory extraction so it doesn't consume mock fetch responses
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  const originalFetch = globalThis.fetch;
  const modelOutputs = [
    textOutputEnvelope,
    durableRunOutputEnvelope,
    unresolvedRunOutputEnvelope,
    approvalRunOutputEnvelope,
    artifact,
  ];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelOutputs.shift()) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const moduleUrl = pathToFileURL(
      path.resolve(
        process.cwd(),
        "../canonical/جاسم/app/api/runtime/jasim-runtime.ts",
      ),
    ).href;
    const runtime = (await import(moduleUrl)) as {
      createRuntimeConversation(input: {
        ownerId: string;
        title?: string;
      }): Promise<{ id: string }>;
      archiveRuntimeConversation(
        conversationId: string,
        ownerId: string,
      ): Promise<{ id: string; status: string }>;
      listRuntimeConversations(ownerId: string): Promise<{
        conversations: Array<{ id: string; status: string }>;
      }>;
      createRuntimeMessage(input: {
        ownerId: string;
        conversationId: string;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
      }): Promise<{ content: string }>;
      getRuntimeConversation(
        conversationId: string,
        ownerId: string,
      ): Promise<{
        messages: Array<{ content: string }>;
      }>;
      createRuntimeBubble(input: {
        ownerId: string;
        conversationId: string;
        mode: "ephemeral" | "interactive" | "persistent";
        title: string;
        semanticDescription: string;
        runtimeWorldId?: string;
      }): Promise<{
        id: string;
        runtimeWorldId: string | null;
        status: "active" | "archived";
        presentation: { surface: string; presentationVersion: number };
      }>;
      getRuntimeBubble(
        bubbleId: string,
        ownerId: string,
      ): Promise<{
        id: string;
        runtimeWorldId: string | null;
        status: "active" | "archived";
        presentation: { surface: string; presentationVersion: number };
      }>;
      listRuntimeBubbles(input: {
        ownerId: string;
        status?: "active" | "archived";
      }): Promise<{ bubbles: Array<{ id: string }> }>;
      getRuntimeBubbleProjection(
        bubbleId: string,
        ownerId: string,
      ): Promise<{ bubble: { id: string }; tasks: unknown[]; runs: unknown[] }>;
      updateRuntimeBubblePresentation(input: {
        bubbleId: string;
        ownerId: string;
        action: "expand" | "minimize" | "archive" | "restore";
        expectedPresentationVersion: number;
      }): Promise<{
        status: "active" | "archived";
        presentation: { surface: string; presentationVersion: number };
      }>;
      resolveRuntimeReferences(input: {
        ownerId: string;
        conversationId: string;
        content: string;
      }): Promise<{
        status: "resolved" | "ambiguous" | "unresolved" | "not_requested";
        references: Array<{ referenceType: string; resolvedId: string; confidence: number }>;
      }>;
      routeRuntimeConversationTurn(input: {
        ownerId: string;
        conversationId: string;
        content: string;
      }): Promise<{
        userMessage: { id: string; content: string };
        assistantMessage: { content: string; metadata: Record<string, unknown> };
        output: {
          kind: string;
          run?: {
            id: string;
            bubbleId: string | null;
            status: string;
            currentState: Record<string, unknown>;
          };
          proposals?: Array<{
            id: string;
            fingerprint: string;
            status: string;
            approval: { status: string } | null;
          }>;
        };
      }>;
      createExecutionProposal(input: {
        ownerId: string;
        conversationId: string;
        runId?: string;
        sourceMessageId: string;
        intentType: "direct_action" | "workflow" | "durable_run";
        capability: string | null;
        inputs: Record<string, unknown>;
        missingInputs: string[];
        risk: "none" | "low" | "medium" | "high" | "critical";
        targetReferences: Array<Record<string, unknown>>;
        referenceResolution: { status: "resolved" | "ambiguous" | "unresolved" | "not_requested"; references: [] };
      }): Promise<{
        id: string;
        fingerprint: string;
        status: string;
        approval: { status: string } | null;
      }>;
      getExecutionProposal(
        proposalId: string,
        ownerId: string,
      ): Promise<{
        id: string;
        fingerprint: string;
        status: string;
        approval: { status: string } | null;
      }>;
      decideExecutionProposalApproval(input: {
        ownerId: string;
        proposalId: string;
        decision: "approve" | "reject";
      }): Promise<{
        status: string;
        approval: { status: string } | null;
      }>;
      createRuntimeRun(input: {
        ownerId: string;
        goal: string;
        idempotencyKey: string;
      }): Promise<{ id: string; status: string }>;
      createRuntimeDag(input: {
        ownerId: string;
        runId: string;
        nodes: Array<{
          nodeKey: string;
          capabilityId: string;
          proposalId?: string;
          inputs?: Record<string, unknown>;
          maxAttempts?: number;
          dependencies?: string[];
        }>;
      }): Promise<{
        status: string;
        dag: Array<{
          id: string;
          nodeKey: string;
          status: string;
          attemptCount: number;
          nextAttemptAt: string | null;
        }>;
      }>;
      getRuntimeRun(runId: string, ownerId: string): Promise<{
        status: string;
        dag: Array<{
          id: string;
          nodeKey: string;
          status: string;
          attemptCount: number;
          nextAttemptAt: string | null;
        }>;
      }>;
      refreshRuntimeDag(input: {
        ownerId: string;
        runId: string;
        now?: Date;
      }): Promise<{ status: string; dag: Array<{ id: string; nodeKey: string; status: string }> }>;
      claimRuntimeDagNode(input: {
        ownerId: string;
        runId: string;
        workerId: string;
        now?: Date;
        leaseDurationMs?: number;
      }): Promise<{
        id: string;
        nodeKey: string;
        status: string;
        workerId: string;
        leaseToken: string;
        leaseExpiresAt: Date;
        fenceVersion: number;
      } | null>;
      heartbeatRuntimeDagNode(input: {
        ownerId: string;
        nodeId: string;
        workerId: string;
        leaseToken: string;
        fenceVersion: number;
        now?: Date;
      }): Promise<{ leaseExpiresAt: Date }>;
      startRuntimeDagNode(input: {
        ownerId: string;
        nodeId: string;
        workerId: string;
        leaseToken: string;
        fenceVersion: number;
        now?: Date;
      }): Promise<{
        id: string;
        nodeKey: string;
        workerId: string;
        leaseToken: string;
        fenceVersion: number;
        capabilityId: string | null;
        proposalId: string | null;
      }>;
      completeRuntimeDagNode(input: {
        ownerId: string;
        nodeId: string;
        workerId: string;
        leaseToken: string;
        fenceVersion: number;
        output: Record<string, unknown>;
        now?: Date;
      }): Promise<{ status: string }>;
      failRuntimeDagNode(input: {
        ownerId: string;
        nodeId: string;
        workerId: string;
        leaseToken: string;
        fenceVersion: number;
        errorCode: "RETRYABLE" | "PERMANENT" | "AUTHORIZATION" | "POLICY" | "INPUT" | "STALE" | "CANCELLED";
        summary: string;
        now?: Date;
      }): Promise<{ status: string }>;
      executeRuntimeDagNode(input: {
        ownerId: string;
        runId: string;
        workerId: string;
        now?: Date;
      }): Promise<{ status: string; nodeKey: string } | null>;
      cancelRuntimeDagRun(input: {
        ownerId: string;
        runId: string;
        now?: Date;
      }): Promise<{ status: string; dag: Array<{ nodeKey: string; status: string }> }>;
      createRuntimeTask(input: {
        goal: string;
        conversationId?: string;
        ownerId: string;
      }): Promise<{ id: string; worldId: string | null; status: string }>;
      actOnRuntimeTask(input: {
        taskId: string;
        ownerId: string;
        actionId: string;
        idempotencyKey: string;
        actionInput?: Record<string, unknown>;
      }): Promise<{ status: string }>;
      getRuntimeWorld(
        worldId: string,
        ownerId: string,
      ): Promise<{
        version: number;
        definition: {
          entities: Array<{ id: string }>;
          state: Record<string, unknown>;
          views: Array<{ id: string }>;
        };
        history: Array<{ version: number }>;
      }>;
      evolveRuntimeWorld(input: {
        worldId: string;
        ownerId: string;
        baseVersion: number;
        summary: string;
        changes: unknown[];
      }): Promise<{ version: number }>;
      RuntimeAccessError: new (...args: unknown[]) => Error;
      RuntimeActionError: new (...args: unknown[]) => Error;
    };

    const ownerSeed = 100_000_000 + Math.floor(Math.random() * 800_000_000);
    const ownerId = String(ownerSeed);
    const conversation = await runtime.createRuntimeConversation({
      ownerId,
      title: "Runtime proof conversation",
    });
    await runtime.createRuntimeMessage({
      ownerId,
      conversationId: conversation.id,
      role: "user",
      content: "First durable message.",
    });
    await runtime.createRuntimeMessage({
      ownerId,
      conversationId: conversation.id,
      role: "assistant",
      content: "Second durable message.",
    });
    const loadedConversation = await runtime.getRuntimeConversation(
      conversation.id,
      ownerId,
    );
    assert(
      loadedConversation.messages.map((message) => message.content).join("|") ===
        "First durable message.|Second durable message.",
      "Conversation messages must load in their persisted order.",
    );
    const archivedConversation = await runtime.createRuntimeConversation({
      ownerId,
      title: "Archived runtime proof",
    });
    await runtime.archiveRuntimeConversation(archivedConversation.id, ownerId);
    const activeConversations = await runtime.listRuntimeConversations(ownerId);
    assert(
      activeConversations.conversations.some(
        (candidate) => candidate.id === conversation.id,
      ) &&
        !activeConversations.conversations.some(
          (candidate) => candidate.id === archivedConversation.id,
        ),
      "Archived conversations must not be returned by the active conversation list.",
    );
    const independentBubble = await runtime.createRuntimeBubble({
      ownerId,
      conversationId: conversation.id,
      mode: "interactive",
      title: "Unbound runtime proof",
      semanticDescription: "A Bubble may exist without a World.",
    });
    assert(
      independentBubble.runtimeWorldId === null,
      "Creating a Bubble must not silently create or bind a World.",
    );
    const phoneStore = await runtime.createRuntimeBubble({
      ownerId,
      conversationId: conversation.id,
      mode: "persistent",
      title: "متجري للآيفون",
      semanticDescription: "متجر فيه آيفون واحد للبيع.",
    });
    assert(
      phoneStore.runtimeWorldId !== null,
      "A persistent Smart Bubble must create its own durable World.",
    );
    const persistentWorldId = phoneStore.runtimeWorldId;
    const reloadedPhoneStore = await runtime.getRuntimeBubble(phoneStore.id, ownerId);
    assert(
      reloadedPhoneStore.runtimeWorldId === persistentWorldId,
      "A persistent Smart Bubble must retain its single World binding.",
    );
    const initialProjection = await runtime.getRuntimeBubbleProjection(
      phoneStore.id,
      ownerId,
    );
    assert(
      initialProjection.bubble.id === phoneStore.id &&
        initialProjection.tasks.length === 0 &&
        initialProjection.runs.length === 0,
      "A new Smart Bubble projection must be owner-scoped and initially empty.",
    );
    const expandedPhoneStore = await runtime.updateRuntimeBubblePresentation({
      bubbleId: phoneStore.id,
      ownerId,
      action: "expand",
      expectedPresentationVersion: phoneStore.presentation.presentationVersion,
    });
    assert(
      expandedPhoneStore.presentation.surface === "expanded" &&
        expandedPhoneStore.presentation.presentationVersion ===
          phoneStore.presentation.presentationVersion + 1,
      "A Bubble presentation transition must advance the server-owned version.",
    );
    let stalePresentationRejected = false;
    try {
      await runtime.updateRuntimeBubblePresentation({
        bubbleId: phoneStore.id,
        ownerId,
        action: "minimize",
        expectedPresentationVersion: phoneStore.presentation.presentationVersion,
      });
    } catch {
      stalePresentationRejected = true;
    }
    assert(
      stalePresentationRejected,
      "A stale Bubble presentation version must be rejected.",
    );
    const archivedPhoneStore = await runtime.updateRuntimeBubblePresentation({
      bubbleId: phoneStore.id,
      ownerId,
      action: "archive",
      expectedPresentationVersion:
        expandedPhoneStore.presentation.presentationVersion,
    });
    assert(
      archivedPhoneStore.status === "archived" &&
        archivedPhoneStore.presentation.presentationVersion ===
          expandedPhoneStore.presentation.presentationVersion + 1,
      "Archiving a Smart Bubble must be a durable, versioned transition.",
    );
    const activeBubblesAfterArchive = await runtime.listRuntimeBubbles({
      ownerId,
      status: "active",
    });
    const archivedBubbles = await runtime.listRuntimeBubbles({
      ownerId,
      status: "archived",
    });
    assert(
      !activeBubblesAfterArchive.bubbles.some((bubble) => bubble.id === phoneStore.id) &&
        archivedBubbles.bubbles.some((bubble) => bubble.id === phoneStore.id),
      "Archived Smart Bubbles must be discoverable separately from active Bubbles.",
    );
    const restoredPhoneStore = await runtime.updateRuntimeBubblePresentation({
      bubbleId: phoneStore.id,
      ownerId,
      action: "restore",
      expectedPresentationVersion:
        archivedPhoneStore.presentation.presentationVersion,
    });
    assert(
      restoredPhoneStore.status === "active" &&
        restoredPhoneStore.presentation.presentationVersion ===
          archivedPhoneStore.presentation.presentationVersion + 1,
      "Restoring a Smart Bubble must reactivate it through the versioned lifecycle.",
    );
    const resolvedStore = await runtime.resolveRuntimeReferences({
      ownerId,
      conversationId: conversation.id,
      content: "متجري الذي فيه الآيفون",
    });
    assert(
      resolvedStore.status === "resolved" &&
        resolvedStore.references[0]?.referenceType === "bubble" &&
        resolvedStore.references[0]?.resolvedId === phoneStore.id,
      "A unique owner-scoped Bubble reference must resolve with evidence.",
    );
    const otherOwner = String(ownerSeed + 1);
    const otherConversation = await runtime.createRuntimeConversation({
      ownerId: otherOwner,
      title: "Other owner",
    });
    await runtime.createRuntimeBubble({
      ownerId: otherOwner,
      conversationId: otherConversation.id,
      mode: "persistent",
      title: "متجري للآيفون",
      semanticDescription: "Foreign Bubble must never be a candidate.",
    });
    const ownerScopedStore = await runtime.resolveRuntimeReferences({
      ownerId,
      conversationId: conversation.id,
      content: "متجري الذي فيه الآيفون",
    });
    assert(
      ownerScopedStore.references[0]?.resolvedId === phoneStore.id,
      "A foreign owner's Bubble must never resolve.",
    );
    let foreignBubbleReadRejected = false;
    try {
      await runtime.getRuntimeBubble(phoneStore.id, otherOwner);
    } catch (error) {
      foreignBubbleReadRejected = error instanceof runtime.RuntimeAccessError;
    }
    assert(
      foreignBubbleReadRejected,
      "A different owner must not read another owner's Smart Bubble.",
    );
    if (process.env.JASIM_SMART_BUBBLE_ONLY === "1") {
      process.stdout.write("JASIM Smart Bubble PostgreSQL proof passed.\n");
      return;
    }
    await runtime.createRuntimeBubble({
      ownerId,
      conversationId: conversation.id,
      mode: "persistent",
      title: "متجر السيارات",
      semanticDescription: "First equally named store.",
    });
    await runtime.createRuntimeBubble({
      ownerId,
      conversationId: conversation.id,
      mode: "persistent",
      title: "متجر السيارات",
      semanticDescription: "Second equally named store.",
    });
    const ambiguousStore = await runtime.resolveRuntimeReferences({
      ownerId,
      conversationId: conversation.id,
      content: "متجر السيارات",
    });
    assert(
      ambiguousStore.status === "ambiguous" && ambiguousStore.references.length === 2,
      `Equally matching owner-scoped references must request clarification: ${JSON.stringify(ambiguousStore)}`,
    );
    const unresolvedReference = await runtime.resolveRuntimeReferences({
      ownerId,
      conversationId: conversation.id,
      content: "متجر لا وجود له باسم النخبة",
    });
    assert(
      unresolvedReference.status === "unresolved",
      "A requested reference with no owner-scoped candidate must remain unresolved.",
    );
    const routed = await runtime.routeRuntimeConversationTurn({
      ownerId,
      conversationId: conversation.id,
      content: "هل تحتاجون أي توضيح قبل البدء؟",
    });
    assert(
      routed.userMessage.content === "هل تحتاجون أي توضيح قبل البدء؟" &&
        routed.assistantMessage.content === textOutputEnvelope.content &&
        routed.output.kind === "text",
      "Output Router must persist a validated text turn without creating a Task or World.",
    );
    const durableRun = await runtime.routeRuntimeConversationTurn({
      ownerId,
      conversationId: conversation.id,
      content: "راقب متجر السيارات.",
    });
    assert(
      durableRun.output.kind === "durable_run" &&
        durableRun.output.run?.bubbleId === null &&
        durableRun.output.run?.status === "awaiting_input" &&
        durableRun.output.run.currentState.effects === "none" &&
        (durableRun.assistantMessage.metadata.referenceResolution as { status?: string })?.status ===
          "ambiguous",
      "Ambiguous references must make a Durable Run await clarification without creating a Bubble.",
    );
    const unresolvedRun = await runtime.routeRuntimeConversationTurn({
      ownerId,
      conversationId: conversation.id,
      content: "راقب متجر لا وجود له باسم النخبة.",
    });
    assert(
      unresolvedRun.output.kind === "durable_run" &&
        unresolvedRun.output.run?.status === "awaiting_input" &&
        (unresolvedRun.assistantMessage.metadata.referenceResolution as { status?: string })
          ?.status === "unresolved",
      "An unresolved reference must keep the Durable Run awaiting input instead of guessing.",
    );
    const approvalTurn = await runtime.routeRuntimeConversationTurn({
      ownerId,
      conversationId: conversation.id,
      content: "حلل بيانات المبيعات بسعر 200.",
    });
    const approvalProposal = approvalTurn.output.proposals?.[0];
    assert(
      approvalTurn.output.run?.status === "awaiting_approval" &&
        approvalProposal?.status === "awaiting_approval" &&
        approvalProposal.approval?.status === "pending",
      "High-risk trusted capabilities must produce a pending fingerprint-bound approval.",
    );
    const approvedProposal = await runtime.decideExecutionProposalApproval({
      ownerId,
      proposalId: approvalProposal.id,
      decision: "approve",
    });
    assert(
      approvedProposal.status === "authorized" && approvedProposal.approval?.status === "approved",
      "Approval must authorize only the exact proposal and must not execute it.",
    );
    await runtime
      .decideExecutionProposalApproval({
        ownerId,
        proposalId: approvalProposal.id,
        decision: "approve",
      })
      .then(
        () => {
          throw new Error("Approval replay must fail.");
        },
        () => undefined,
      );
    const equivalentProposal = await runtime.createExecutionProposal({
      ownerId,
      conversationId: conversation.id,
      runId: approvalTurn.output.run?.id,
      sourceMessageId: approvalTurn.userMessage.id,
      intentType: "durable_run",
      capability: "local-analysis",
      inputs: { currency: "KWD", price: 200 },
      missingInputs: [],
      risk: "high",
      targetReferences: [],
      referenceResolution: { status: "not_requested", references: [] },
    });
    assert(
      equivalentProposal.fingerprint === approvalProposal.fingerprint,
      "Canonical JSON ordering must not change a proposal fingerprint.",
    );
    const revisedProposal = await runtime.createExecutionProposal({
      ownerId,
      conversationId: conversation.id,
      runId: approvalTurn.output.run?.id,
      sourceMessageId: approvalTurn.userMessage.id,
      intentType: "durable_run",
      capability: "local-analysis",
      inputs: { currency: "KWD", price: 250 },
      missingInputs: [],
      risk: "high",
      targetReferences: [],
      referenceResolution: { status: "not_requested", references: [] },
    });
    const invalidatedOriginal = await runtime.getExecutionProposal(approvalProposal.id, ownerId);
    assert(
      revisedProposal.fingerprint !== approvalProposal.fingerprint &&
        invalidatedOriginal.status === "superseded" &&
        invalidatedOriginal.approval?.status === "invalidated",
      "A changed critical input must supersede the old proposal and invalidate its approval.",
    );
    const unknownProposal = await runtime.createExecutionProposal({
      ownerId,
      conversationId: conversation.id,
      sourceMessageId: approvalTurn.userMessage.id,
      intentType: "direct_action",
      capability: "system.executeShell",
      inputs: {},
      missingInputs: [],
      risk: "low",
      targetReferences: [],
      referenceResolution: { status: "not_requested", references: [] },
    });
    assert(
      unknownProposal.status === "blocked",
      "An unknown or injected capability must remain blocked with no effect.",
    );
    await runtime.getExecutionProposal(approvalProposal.id, otherOwner).then(
      () => {
        throw new Error("Foreign owners must not read an execution proposal.");
      },
      () => undefined,
    );
    await runtime
      .createRuntimeDag({
        ownerId,
        runId: approvalTurn.output.run!.id,
        nodes: [
          {
            nodeKey: "tampered-inputs",
            proposalId: approvalProposal.id,
            capabilityId: "local-analysis",
            inputs: { currency: "KWD", price: 999 },
          },
        ],
      })
      .then(
        () => {
          throw new Error("A proposal approval must not authorize substituted DAG node inputs.");
        },
        () => undefined,
      );
    const dagRun = await runtime.createRuntimeRun({
      ownerId,
      goal: "Durable DAG A to B proof",
      idempotencyKey: `dag-a-b-${crypto.randomUUID()}`,
    });
    const dag = await runtime.createRuntimeDag({
      ownerId,
      runId: dagRun.id,
      nodes: [
        { nodeKey: "A", capabilityId: "local-calculation", inputs: { values: [1, 2] } },
        {
          nodeKey: "B",
          capabilityId: "local-analysis",
          inputs: { source: "A" },
          dependencies: ["A"],
        },
      ],
    });
    assert(
      dag.dag.find((node) => node.nodeKey === "A")?.status === "READY" &&
        dag.dag.find((node) => node.nodeKey === "B")?.status === "PENDING",
      "A root node must be READY while its SUCCESS_REQUIRED dependent remains PENDING.",
    );
    const dagClaimA = await runtime.claimRuntimeDagNode({
      ownerId,
      runId: dagRun.id,
      workerId: "dag-worker-a",
    });
    assert(dagClaimA?.nodeKey === "A", "The first worker must claim the only ready root node.");
    const heartbeat = await runtime.heartbeatRuntimeDagNode({
      ownerId,
      nodeId: dagClaimA.id,
      workerId: dagClaimA.workerId,
      leaseToken: dagClaimA.leaseToken,
      fenceVersion: dagClaimA.fenceVersion,
    });
    assert(heartbeat.leaseExpiresAt > new Date(), "The current lease holder must be able to heartbeat.");
    await runtime.startRuntimeDagNode({
      ownerId,
      nodeId: dagClaimA.id,
      workerId: dagClaimA.workerId,
      leaseToken: dagClaimA.leaseToken,
      fenceVersion: dagClaimA.fenceVersion,
    });
    await runtime.completeRuntimeDagNode({
      ownerId,
      nodeId: dagClaimA.id,
      workerId: dagClaimA.workerId,
      leaseToken: dagClaimA.leaseToken,
      fenceVersion: dagClaimA.fenceVersion,
      output: { sum: 3 },
    });
    const afterA = await runtime.getRuntimeRun(dagRun.id, ownerId);
    assert(
      afterA.dag.find((node) => node.nodeKey === "B")?.status === "READY",
      "Completing A must make B READY server-side.",
    );
    const localWorkerResult = await runtime.executeRuntimeDagNode({
      ownerId,
      runId: dagRun.id,
      workerId: "dag-worker-local",
    });
    assert(
      localWorkerResult?.nodeKey === "B" && localWorkerResult.status === "COMPLETED" &&
        (await runtime.getRuntimeRun(dagRun.id, ownerId)).status === "completed",
      "A trusted local worker must complete a safe capability and derive Run completion from DAG state.",
    );

    const fanRun = await runtime.createRuntimeRun({
      ownerId,
      goal: "Durable DAG fan-out join proof",
      idempotencyKey: `dag-fan-${crypto.randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId,
      runId: fanRun.id,
      nodes: [
        { nodeKey: "A", capabilityId: "local-analysis" },
        { nodeKey: "B", capabilityId: "local-analysis", dependencies: ["A"] },
        { nodeKey: "C", capabilityId: "local-analysis", dependencies: ["A"] },
        { nodeKey: "D", capabilityId: "local-analysis", dependencies: ["B", "C"] },
      ],
    });
    for (const expected of ["A", "B", "C"]) {
      const completed = await runtime.executeRuntimeDagNode({
        ownerId,
        runId: fanRun.id,
        workerId: `fan-worker-${expected}`,
      });
      assert(completed?.nodeKey === expected, `Fan-out worker must execute ${expected} in dependency order.`);
      if (expected === "B") {
        assert(
          (await runtime.getRuntimeRun(fanRun.id, ownerId)).dag.find((node) => node.nodeKey === "D")
            ?.status === "PENDING",
          "The join node must remain PENDING until every required upstream succeeds.",
        );
      }
    }
    assert(
      (await runtime.getRuntimeRun(fanRun.id, ownerId)).dag.find((node) => node.nodeKey === "D")
        ?.status === "READY",
      "The join node must become READY only after all required upstream nodes complete.",
    );

    const claimRun = await runtime.createRuntimeRun({
      ownerId,
      goal: "Atomic claim and fencing proof",
      idempotencyKey: `dag-claim-${crypto.randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId,
      runId: claimRun.id,
      nodes: [{ nodeKey: "only", capabilityId: "local-analysis" }],
    });
    const [parallelA, parallelB] = await Promise.all([
      runtime.claimRuntimeDagNode({ ownerId, runId: claimRun.id, workerId: "parallel-a", leaseDurationMs: 1_000 }),
      runtime.claimRuntimeDagNode({ ownerId, runId: claimRun.id, workerId: "parallel-b", leaseDurationMs: 1_000 }),
    ]);
    const winningClaim = parallelA ?? parallelB;
    assert(
      Boolean(winningClaim) && Number(Boolean(parallelA)) + Number(Boolean(parallelB)) === 1,
      "Parallel workers must produce exactly one atomic claim for one ready node.",
    );
    if (!winningClaim) throw new Error("Parallel claim proof did not yield a winning claim.");
    const recoveryTime = new Date(winningClaim.leaseExpiresAt.getTime() + 1);
    const recoveredClaim = await runtime.claimRuntimeDagNode({
      ownerId,
      runId: claimRun.id,
      workerId: "fence-new",
      now: recoveryTime,
      leaseDurationMs: 1_000,
    });
    assert(
      recoveredClaim?.fenceVersion === winningClaim.fenceVersion + 1,
      "A recovered lease claim must advance the monotonic fencing version.",
    );
    if (!recoveredClaim) throw new Error("Expired lease did not yield a recovered claim.");
    await runtime.startRuntimeDagNode({
      ownerId,
      nodeId: recoveredClaim.id,
      workerId: recoveredClaim.workerId,
      leaseToken: recoveredClaim.leaseToken,
      fenceVersion: recoveredClaim.fenceVersion,
      now: recoveryTime,
    });
    await runtime
      .completeRuntimeDagNode({
        ownerId,
        nodeId: winningClaim.id,
        workerId: winningClaim.workerId,
        leaseToken: winningClaim.leaseToken,
        fenceVersion: winningClaim.fenceVersion,
        output: { stale: true },
        now: recoveryTime,
      })
      .then(
        () => {
          throw new Error("A stale worker must never complete a re-leased node.");
        },
        () => undefined,
      );
    await runtime.completeRuntimeDagNode({
      ownerId,
      nodeId: recoveredClaim.id,
      workerId: recoveredClaim.workerId,
      leaseToken: recoveredClaim.leaseToken,
      fenceVersion: recoveredClaim.fenceVersion,
      output: { fresh: true },
      now: recoveryTime,
    });

    const retryRun = await runtime.createRuntimeRun({
      ownerId,
      goal: "Retry and permanent failure proof",
      idempotencyKey: `dag-retry-${crypto.randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId,
      runId: retryRun.id,
      nodes: [{ nodeKey: "retry", capabilityId: "local-analysis", maxAttempts: 2 }],
    });
    const retryClaim = await runtime.claimRuntimeDagNode({
      ownerId,
      runId: retryRun.id,
      workerId: "retry-worker",
    });
    await runtime.startRuntimeDagNode({
      ownerId,
      nodeId: retryClaim!.id,
      workerId: retryClaim!.workerId,
      leaseToken: retryClaim!.leaseToken,
      fenceVersion: retryClaim!.fenceVersion,
    });
    const retryScheduled = await runtime.failRuntimeDagNode({
      ownerId,
      nodeId: retryClaim!.id,
      workerId: retryClaim!.workerId,
      leaseToken: retryClaim!.leaseToken,
      fenceVersion: retryClaim!.fenceVersion,
      errorCode: "RETRYABLE",
      summary: "Controlled retryable proof failure.",
    });
    assert(retryScheduled.status === "RETRY_SCHEDULED", "Only retryable failures may schedule a retry.");
    const retryRunState = await runtime.getRuntimeRun(retryRun.id, ownerId);
    const retryNode = retryRunState.dag.find((node) => node.nodeKey === "retry")!;
    await runtime.refreshRuntimeDag({
      ownerId,
      runId: retryRun.id,
      now: new Date(new Date(retryNode.nextAttemptAt!).getTime() + 1),
    });
    const retrySuccess = await runtime.executeRuntimeDagNode({
      ownerId,
      runId: retryRun.id,
      workerId: "retry-worker-second",
    });
    assert(retrySuccess?.status === "COMPLETED", "A retryable node must become executable again after its delay.");

    const cancelledRun = await runtime.createRuntimeRun({
      ownerId,
      goal: "Cancellation proof",
      idempotencyKey: `dag-cancel-${crypto.randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId,
      runId: cancelledRun.id,
      nodes: [
        { nodeKey: "A", capabilityId: "local-analysis" },
        { nodeKey: "B", capabilityId: "local-analysis", dependencies: ["A"] },
      ],
    });
    const completedBeforeCancellation = await runtime.executeRuntimeDagNode({
      ownerId,
      runId: cancelledRun.id,
      workerId: "cancelled-run-completer",
    });
    assert(
      completedBeforeCancellation?.nodeKey === "A" &&
        completedBeforeCancellation.status === "COMPLETED",
      "A node completed before cancellation must remain a durable terminal result.",
    );
    const cancelled = await runtime.cancelRuntimeDagRun({ ownerId, runId: cancelledRun.id });
    assert(
      cancelled.status === "cancelled" &&
        cancelled.dag.find((node) => node.nodeKey === "A")?.status === "COMPLETED" &&
        cancelled.dag.find((node) => node.nodeKey === "B")?.status === "CANCELLED",
      "Cancellation must preserve completed nodes and prevent only nonterminal nodes from future execution.",
    );
    assert(
      (await runtime.claimRuntimeDagNode({
        ownerId,
        runId: cancelledRun.id,
        workerId: "cancelled-worker",
      })) === null,
      "A cancelled Run must never offer a node for a new claim.",
    );
    await runtime
      .claimRuntimeDagNode({ ownerId: otherOwner, runId: dagRun.id, workerId: "foreign-worker" })
      .then(
        () => {
          throw new Error("A foreign owner must not claim another owner's DAG node.");
        },
        () => undefined,
      );

    const created = await runtime.createRuntimeTask({
      ownerId,
      conversationId: conversation.id,
      goal: "Coordinate an unfamiliar neighborhood repair exchange.",
    });
    assert(
      created.worldId === null,
      "A general Task must not silently create a durable World.",
    );

    const context = await runtime.actOnRuntimeTask({
      taskId: created.id,
      ownerId,
      actionId: "provide-context",
      idempotencyKey: `runtime-proof-context-${created.id}`,
      actionInput: { neighborhood: "North", categories: ["bicycles", "appliances"] },
    });
    assert(context.status === "awaiting_approval", "Context transition did not persist.");

    const beforeWorldEvolution = await runtime.getRuntimeWorld(persistentWorldId, ownerId);
    assert(
      beforeWorldEvolution.version === 1,
      "A Bubble World must remain independent from a general Task transition.",
    );

    const evolved = await runtime.evolveRuntimeWorld({
      worldId: persistentWorldId,
      ownerId,
      baseVersion: beforeWorldEvolution.version,
      summary: "Add a reusable helper profile and an operations view.",
      changes: [
        {
          op: "upsert_entity",
          entity: {
            id: "helper-profile",
            name: "Helper profile",
            type: "profile",
            attributes: { verified: false },
          },
        },
        { op: "set_state", key: "matchingMode", value: "assisted" },
        {
          op: "upsert_view",
          view: {
            id: "matching-board",
            type: "collection",
            title: "Matching board",
            config: { collection: "repair requests" },
          },
        },
      ],
    });
    assert(evolved.version === 2, "Version-checked world evolution did not advance.");

    const reloaded = await runtime.getRuntimeWorld(persistentWorldId, ownerId);
    assert(
      reloaded.definition.entities.some((entity) => entity.id === "helper-profile") &&
        reloaded.definition.state.matchingMode === "assisted" &&
        reloaded.definition.views.some((view) => view.id === "matching-board") &&
        reloaded.history.length === 2,
      "Reloaded world state did not retain its independent evolution history.",
    );

    let staleVersionRejected = false;
    try {
      await runtime.evolveRuntimeWorld({
        worldId: persistentWorldId,
        ownerId,
        baseVersion: 1,
        summary: "This stale change must be rejected.",
        changes: [{ op: "set_state", key: "stale", value: true }],
      });
    } catch (error) {
      staleVersionRejected = error instanceof runtime.RuntimeActionError;
    }
    assert(staleVersionRejected, "A stale world edit must not overwrite a newer version.");

    let isolated = false;
    try {
      await runtime.getRuntimeWorld(persistentWorldId, `other-${ownerId}`);
    } catch (error) {
      isolated = error instanceof runtime.RuntimeAccessError;
    }
    assert(isolated, "A different owner must not read another owner's world.");
    let conversationIsolated = false;
    try {
      await runtime.getRuntimeConversation(conversation.id, `other-${ownerId}`);
    } catch (error) {
      conversationIsolated = error instanceof runtime.RuntimeAccessError;
    }
    assert(conversationIsolated, "A different owner must not read another owner's conversation.");
    let bubbleIsolated = false;
    try {
      await runtime.getRuntimeBubble(phoneStore.id, otherOwner);
    } catch (error) {
      bubbleIsolated = error instanceof runtime.RuntimeAccessError;
    }
    assert(bubbleIsolated, "A different owner must not read another owner's Bubble.");
    process.stdout.write("JASIM independent world runtime proof passed.\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});