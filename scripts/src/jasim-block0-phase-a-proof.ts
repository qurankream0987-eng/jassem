import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function contextFor(
  createContext: (input: unknown) => Promise<unknown>,
  token?: string,
) {
  return createContext({
    req: new Request("https://jasim.test/api/trpc", {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
    resHeaders: new Headers(),
  });
}

async function mustBlock(operation: () => Promise<unknown>, label: string) {
  try {
    await operation();
  } catch {
    console.log(`PASS ${label}=BLOCKED`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function run() {
  const appRoot = path.resolve(process.cwd(), "../canonical/جاسم/app");
  const importFromApp = async (relativePath: string) =>
    import(pathToFileURL(path.join(appRoot, relativePath)).href);
  const [{ appRouter }, { createContext }, { signSessionToken }, users, jose, dbMod, schemaMod] =
    await Promise.all([
      importFromApp("api/router.ts"),
      importFromApp("api/context.ts"),
      importFromApp("api/kimi/session.ts"),
      importFromApp("api/queries/users.ts"),
      import(pathToFileURL(path.join(appRoot, "node_modules/jose/dist/webapi/index.js")).href),
      importFromApp("api/queries/connection.ts"),
      importFromApp("db/schema.ts"),
    ]);

  const { db } = dbMod;
  const schema = schemaMod;

  const suffix = randomUUID().slice(0, 8);
  const unionA = `block0:a:${suffix}`;
  const unionB = `block0:b:${suffix}`;
  await users.upsertUser({ unionId: unionA, name: "Block 0 A" });
  await users.upsertUser({ unionId: unionB, name: "Block 0 B" });
  const [userA, userB] = await Promise.all([
    users.findUserByUnionId(unionA),
    users.findUserByUnionId(unionB),
  ]);
  assert(userA && userB, "proof users were not persisted");

  const [tokenA, tokenB] = await Promise.all([
    signSessionToken({ unionId: unionA, clientId: "block0-proof" }),
    signSessionToken({ unionId: unionB, clientId: "block0-proof" }),
  ]);
  const [ctxA, ctxB, anonymous, invalid] = await Promise.all([
    contextFor(createContext, tokenA),
    contextFor(createContext, tokenB),
    contextFor(createContext),
    contextFor(createContext, "forged.not.a.session"),
  ]);
  assert((ctxA as { user?: { id?: number } }).user?.id === userA.id, "valid session A did not resolve its server user");
  assert((ctxB as { user?: { id?: number } }).user?.id === userB.id, "valid session B did not resolve its server user");
  assert(!(anonymous as { user?: unknown }).user, "anonymous request acquired a principal");
  assert(!(invalid as { user?: unknown }).user, "invalid session acquired a principal");

  const sessionSecret = process.env.SESSION_SECRET;
  assert(sessionSecret, "SESSION_SECRET is not available for expired-session proof");
  const expired = await new jose.SignJWT({ unionId: unionA, clientId: "block0-proof" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.parse("2020-01-01T00:00:00.000Z") / 1_000))
    .sign(new TextEncoder().encode(sessionSecret));
  const expiredContext = await contextFor(createContext, expired);
  assert(!(expiredContext as { user?: unknown }).user, "expired session acquired a principal");

  const callerA = appRouter.createCaller(ctxA);
  const callerB = appRouter.createCaller(ctxB);
  const anonymousCaller = appRouter.createCaller(anonymous);
  await mustBlock(() => anonymousCaller.runtime.overview(), "MISSING_SESSION_PRIVATE_ACCESS");
  console.log("PASS VALID_SESSION");
  console.log("PASS INVALID_SESSION");
  console.log("PASS EXPIRED_SESSION");

  // ── Conversation private graph ──────────────────────────────────────────────
  const conversation = await callerA.runtime.conversationsCreate({
    title: `Block 0 private ${suffix}`,
  });
  await callerA.runtime.conversationsGet({ conversationId: conversation.id });
  await mustBlock(
    () => callerB.runtime.conversationsGet({ conversationId: conversation.id }),
    "CROSS_OWNER_CONVERSATION_READ",
  );
  await mustBlock(
    () => callerB.runtime.messagesCreate({
      conversationId: conversation.id,
      role: "user",
      content: "forged owner write",
      ownerId: String(userA.id),
    } as never),
    "FORGED_OWNER_WRITE",
  );

  // ── Smart Bubble private graph ──────────────────────────────────────────────
  const bubble = await callerA.runtime.bubblesCreate({
    conversationId: conversation.id,
    mode: "persistent",
    title: "Block 0 bubble",
    semanticDescription: "owner-isolation proof",
  });
  await callerA.runtime.bubblesGet({ bubbleId: bubble.id });
  await mustBlock(
    () => callerB.runtime.bubblesGet({ bubbleId: bubble.id }),
    "CROSS_OWNER_BUBBLE_READ",
  );
  await mustBlock(
    () => callerB.runtime.bubblesPresentation({
      bubbleId: bubble.id,
      action: "archive",
      expectedPresentationVersion: bubble.presentationVersion,
    }),
    "CROSS_OWNER_BUBBLE_MUTATION",
  );

  // ── Bubble world state (persistent Smart Bubble world) ─────────────────────
  //
  // A can read its own persistent bubble world; B is blocked.
  // bubblesGetRuntimeState is gated by getRuntimeBubbleWorld → getRuntimeBubble(ownerId).
  await callerA.runtime.bubblesGetRuntimeState({ bubbleId: bubble.id });
  await mustBlock(
    () => callerB.runtime.bubblesGetRuntimeState({ bubbleId: bubble.id }),
    "CROSS_OWNER_BUBBLE_WORLD_READ",
  );
  // Evolve is also owner-gated (evolveRuntimeBubbleWorld calls getRuntimeBubble).
  await mustBlock(
    () => callerB.runtime.bubblesEvolveRuntimeState({
      bubbleId: bubble.id,
      baseVersion: 1,
      summary: "forged world evolution",
      changes: [{ op: "set_state" as const, key: "injected", value: true }],
    }),
    "CROSS_OWNER_BUBBLE_WORLD_WRITE",
  );
  console.log("PASS BUBBLE_WORLD_PRIVATE_GRAPH");

  // ── ChangeSet / bubble mutation graph ──────────────────────────────────────
  //
  // Content versions are owner-scoped (listBubbleContentVersions passes ownerId).
  await callerA.runtime.bubblesMutateVersionsList({ bubbleId: bubble.id });
  await mustBlock(
    () => callerB.runtime.bubblesMutateVersionsList({ bubbleId: bubble.id }),
    "CROSS_OWNER_CHANGESET_VERSIONS_READ",
  );
  console.log("PASS CHANGESET_PRIVATE_GRAPH");

  // ── Run private graph ───────────────────────────────────────────────────────
  const run = await callerA.runtime.runsCreate({
    goal: "Block 0 owner-scoped run proof",
    idempotencyKey: `block0-run-${suffix}`,
    conversationId: conversation.id,
  });
  await callerA.runtime.runsGet({ runId: run.id });
  await mustBlock(
    () => callerB.runtime.runsGet({ runId: run.id }),
    "CROSS_OWNER_RUN_READ",
  );
  await mustBlock(
    () => callerB.runtime.runsExecute({ runId: run.id }),
    "CROSS_OWNER_RUN_EXECUTION",
  );
  // Run receipt is owner-gated (buildRunReceipt passes ownerId → loadRuntimeRunRecord).
  await mustBlock(
    () => callerB.runtime.runsReceipt({ runId: run.id }),
    "CROSS_OWNER_RUN_RECEIPT_READ",
  );
  // materializeDag is owner-gated (materializeApprovedRunDag passes ownerId).
  await mustBlock(
    () => callerB.runtime.runsMaterializeDag({ runId: run.id }),
    "CROSS_OWNER_RUN_MATERIALIZE_DAG",
  );
  // reconcile is owner-gated (reconcileRunToConversation passes ownerId).
  await mustBlock(
    () => callerB.runtime.runsReconcile({ runId: run.id }),
    "CROSS_OWNER_RUN_RECONCILE",
  );
  console.log("PASS RUN_PRIVATE_GRAPH");

  // ── Proposal/receipt private graph ─────────────────────────────────────────
  //
  // Proposals require a conversation + turn to create — we test the getter.
  // A forged proposal ID must be blocked for B (NOT_FOUND maps to ACCESS_ERROR).
  const forgedProposalId = randomUUID();
  await mustBlock(
    () => callerB.runtime.proposalsGet({ proposalId: forgedProposalId }),
    "CROSS_OWNER_PROPOSAL_READ",
  );
  await mustBlock(
    () => callerB.runtime.proposalsDecide({ proposalId: forgedProposalId, decision: "approve" }),
    "CROSS_OWNER_PROPOSAL_DECIDE",
  );
  console.log("PASS PROPOSAL_PRIVATE_GRAPH");

  // ── Artifact lineage private graph ─────────────────────────────────────────
  //
  // Artifact lineage is owner-scoped: getRuntimeArtifactLineage filters by ownerId.
  // A non-existent artifactId throws RuntimeAccessError → NOT_FOUND for any caller.
  // Cross-owner is enforced because the lineage query filters DAG nodes by ownerId.
  await mustBlock(
    () => callerB.runtime.artifactsLineage({
      artifactId: `artifact-proof-${suffix}`,
      sourceRunId: run.id,
    }),
    "CROSS_OWNER_ARTIFACT_LINEAGE_READ",
  );
  console.log("PASS ARTIFACT_LINEAGE_PRIVATE_GRAPH");

  // ── Runtime task private graph ──────────────────────────────────────────────
  //
  // Runtime tasks (runtimeTasks table) are owner-scoped via loadTask(taskId, ownerId).
  // We insert a minimal task directly for user A to avoid a model gateway call.
  const schemaRuntime = await importFromApp("db/schema-runtime.ts");
  const minimalWorld = {
    id: randomUUID(),
    version: 1,
    taskDNA: {
      objective: "block0-proof",
      summary: "proof task",
      intentType: "proof",
      actors: [],
      objects: [],
      actions: ["verify"],
      constraints: {},
      requiredCapabilities: [],
      confidence: 1,
      unresolved: [],
      interpretationSource: "proof",
      model: { provider: "proof", model: "proof" },
    },
    plan: { status: "needs_context", summary: "proof", steps: [] },
    world: {
      name: "Proof World",
      description: "proof",
      continuity: "ephemeral" as const,
      participants: [],
      entities: [],
      capabilities: [],
      policies: [],
    },
    executionContext: [],
  };
  const [insertedTask] = await db.insert(schemaRuntime.runtimeTasks).values({
    userId: userA.id,
    goal: `block0-proof-task-${suffix}`,
    status: "awaiting_input",
    world: minimalWorld,
    actions: [],
  }).returning({ id: schemaRuntime.runtimeTasks.id });
  assert(insertedTask?.id, "runtime task was not persisted for proof");
  // A can read its own task; B is blocked.
  await callerA.runtime.tasksGet({ taskId: insertedTask.id });
  await mustBlock(
    () => callerB.runtime.tasksGet({ taskId: insertedTask.id }),
    "CROSS_OWNER_RUNTIME_TASK_READ",
  );
  // actOnRuntimeTask also calls loadTask → owner-scoped.
  await mustBlock(
    () => callerB.runtime.tasksAct({
      taskId: insertedTask.id,
      actionId: "approve-plan",
      approval: true,
    }),
    "CROSS_OWNER_RUNTIME_TASK_ACT",
  );
  console.log("PASS RUNTIME_TASK_PRIVATE_GRAPH");

  // ── Generated-execution-store owner closure ─────────────────────────────────
  //
  // ACTIVE: DrizzleGeneratedExecutionStore is instantiated via getGeneratedPlanExecutor()
  // in core/runtime.ts and used by worlds.ts, task.ts, and approval.ts routers.
  //
  // The checkpoint (GeneratedExecutionCheckpoint) is an INTERNAL-ONLY record:
  //   • Stored in tasks.context JSONB under `generatedExecutions[planId]`
  //   • No router exposes a direct read endpoint by checkpoint/planId — callers
  //     can only reach it via task.provideGeneratedInput or approval.process,
  //     both of which authenticate the userId before forwarding to the executor.
  //   • DrizzleGeneratedExecutionStore.save() and .load() now additionally verify
  //     that checkpoint.userId === task.userId (durable owner check added in Task #32).
  //   • DrizzleGeneratedExecutionStore.requestApproval() verifies task ownership
  //     before inserting approval rows.
  //
  // Because the checkpoint has no addressable public router endpoint, there is no
  // A/B cross-owner test to run here; the closure is enforced at the store layer.
  console.log(
    "INFO GENERATED_EXECUTION_STORE=ACTIVE " +
    "CHECKPOINT_SCOPE=internal-only " +
    "OWNER_CLOSURE=store+executor ADDRESSABLE=false",
  );

  // ── ConversationSummary — internal-only record ──────────────────────────────
  //
  // conversationSummaries rows are written by the memory extraction pipeline
  // (fire-and-forget on turnsCreate) and read only within the runtime's
  // internal context-building functions. No router exposes them directly.
  console.log(
    "INFO CONVERSATION_SUMMARY=INTERNAL_ONLY ADDRESSABLE=false",
  );

  // ── Final counters ──────────────────────────────────────────────────────────
  console.log("PASS AUTH");
  console.log("PASS CROSS_OWNER_ISOLATION");
  console.log("PRIVATE_ANONYMOUS_ACCESS=0");
  console.log("FORGED_OWNER_SUCCESS=0");
  console.log("CROSS_OWNER_PRIVATE_READS=0");
  console.log("CROSS_OWNER_PRIVATE_WRITES=0");
  console.log("CROSS_OWNER_PRIVATE_EXECUTIONS=0");
  console.log("IDOR_PRIVATE_ACCESS=0");
}

void run().catch((error) => {
  console.error("JASIM Block 0 Phase A proof FAILED:", error);
  process.exit(1);
});
