import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  conversations,
  discoveryCandidates,
  discoveryResultSets,
  executionProposals,
  generatedSystems,
  messages,
  proposalApprovals,
  referenceBindings,
  runs,
  runtimeTasks,
} from "@db/schema";
import {
  ActiveWorkspaceProjectionSchema,
  PresentationDefinitionSchema,
  type ActiveWorkspaceAttention,
  type ActiveWorkspaceProjection,
  type ActiveWorkspaceStatus,
  type PresentationDefinition,
} from "./presentation-fabric";

type ConversationRow = typeof conversations.$inferSelect;
type RuntimeTaskRow = typeof runtimeTasks.$inferSelect;
type RuntimeRunRow = typeof runs.$inferSelect;
type ProposalRow = typeof executionProposals.$inferSelect;

function numericId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const dates = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function presentationFromMessage(metadata: unknown): PresentationDefinition | null {
  const record = asRecord(metadata);
  const candidate = record?.presentation;
  const parsed = PresentationDefinitionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function conversationIdFromInput(value: string | undefined): number | null {
  return value ? numericId(value) : null;
}

function isTerminalTask(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function isTerminalRun(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function statusFromSources(
  task: RuntimeTaskRow | null,
  run: RuntimeRunRow | null,
  approval: { status: string } | null,
  hasConversation: boolean,
): ActiveWorkspaceStatus {
  if (approval?.status === "pending") return "awaiting_approval";
  const source = run?.status ?? task?.status;
  switch (source) {
    case "awaiting_input":
    case "waiting_input":
      return "awaiting_input";
    case "awaiting_approval":
    case "waiting_approval":
      return "awaiting_approval";
    case "running":
    case "scheduled":
    case "ready":
    case "verifying":
    case "waiting":
      return "running";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    default:
      return hasConversation ? "active" : "idle";
  }
}

function attentionFromSources(
  task: RuntimeTaskRow | null,
  run: RuntimeRunRow | null,
  proposal: ProposalRow | null,
  approval: { id: string; status: string } | null,
): ActiveWorkspaceAttention[] {
  const attention: ActiveWorkspaceAttention[] = [];
  const taskStatus = task?.status;
  const runStatus = run?.status;
  if (approval?.status === "pending" || proposal?.status === "awaiting_approval") {
    attention.push({
      kind: "approval_required",
      sourceId: approval?.id ?? proposal?.id ?? "approval",
      severity: "warning",
      reason: "An execution proposal is waiting for approval.",
      actionIntent: "approve",
    });
  }
  if (taskStatus === "awaiting_input" || runStatus === "awaiting_input") {
    attention.push({
      kind: "input_required",
      sourceId: task?.id ?? run?.id ?? "input",
      severity: "info",
      reason: "The active goal is waiting for input.",
      actionIntent: "provide_input",
    });
  }
  if (taskStatus === "blocked" || runStatus === "blocked") {
    attention.push({
      kind: "blocked",
      sourceId: task?.id ?? run?.id ?? "blocked",
      severity: "warning",
      reason: "The active goal is blocked and needs recovery.",
    });
  }
  if (taskStatus === "failed" || runStatus === "failed") {
    attention.push({
      kind: "failed",
      sourceId: task?.id ?? run?.id ?? "failed",
      severity: "error",
      reason: "The active goal failed.",
    });
  }
  if (
    attention.length === 0 &&
    (runStatus === "running" || runStatus === "waiting" || taskStatus === "running")
  ) {
    attention.push({
      kind: "ongoing",
      sourceId: run?.id ?? task?.id ?? "ongoing",
      severity: "info",
      reason: "The active goal is still in progress.",
    });
  }
  return attention;
}

function emptyProjection(ownerId: string): ActiveWorkspaceProjection {
  return {
    kind: "active_workspace_projection",
    version: 1,
    workspaceId: `owner:${ownerId}:idle`,
    conversation: null,
    activeGoal: null,
    currentPresentation: null,
    resultSet: null,
    selectedEntityReferences: [],
    activeRun: null,
    activeAction: null,
    approval: null,
    transactionReference: null,
    worldReference: null,
    status: "idle",
    attention: [],
    availablePresentationActions: [],
    updatedAt: null,
    presentationVersion: "presentation:1",
  };
}

function projectConversation(conversation: ConversationRow): ActiveWorkspaceProjection["conversation"] {
  return {
    id: String(conversation.id),
    title: conversation.title,
    status: conversation.status === "archived" ? "archived" : "active",
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export async function getActiveWorkspaceProjection(input: {
  ownerId: string;
  conversationId?: string;
}): Promise<ActiveWorkspaceProjection> {
  const ownerNumber = numericId(input.ownerId);
  if (!ownerNumber) return emptyProjection(input.ownerId);

  const requestedConversationId = conversationIdFromInput(input.conversationId);
  const conversationRows = await db
    .select()
    .from(conversations)
    .where(
      requestedConversationId
        ? and(eq(conversations.id, requestedConversationId), eq(conversations.userId, ownerNumber))
        : and(eq(conversations.userId, ownerNumber), eq(conversations.status, "active")),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  const conversation = conversationRows[0];
  if (!conversation) return emptyProjection(input.ownerId);

  const conversationId = String(conversation.id);
  const conversationNumber = conversation.id;
  const [
    latestMessages,
    taskRows,
    runRows,
    proposalRows,
    resultSetRows,
    referenceRows,
    worldRows,
  ] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationNumber))
      .orderBy(desc(messages.createdAt))
      .limit(1),
    db
      .select()
      .from(runtimeTasks)
      .where(
        and(
          eq(runtimeTasks.userId, ownerNumber),
          eq(runtimeTasks.conversationId, conversationNumber),
        ),
      )
      .orderBy(desc(runtimeTasks.updatedAt))
      .limit(8),
    db
      .select()
      .from(runs)
      .where(and(eq(runs.ownerId, input.ownerId), eq(runs.conversationId, conversationId)))
      .orderBy(desc(runs.updatedAt))
      .limit(8),
    db
      .select()
      .from(executionProposals)
      .where(
        and(
          eq(executionProposals.ownerId, input.ownerId),
          eq(executionProposals.conversationId, conversationId),
        ),
      )
      .orderBy(desc(executionProposals.updatedAt))
      .limit(8),
    db
      .select()
      .from(discoveryResultSets)
      .where(
        and(
          eq(discoveryResultSets.ownerId, input.ownerId),
          eq(discoveryResultSets.conversationId, conversationId),
        ),
      )
      .orderBy(desc(discoveryResultSets.createdAt))
      .limit(1),
    db
      .select()
      .from(referenceBindings)
      .where(
        and(
          eq(referenceBindings.ownerId, input.ownerId),
          eq(referenceBindings.conversationId, conversationId),
          isNull(referenceBindings.supersededAt),
        ),
      )
      .orderBy(desc(referenceBindings.createdAt))
      .limit(50),
    db
      .select()
      .from(generatedSystems)
      .where(
        and(
          eq(generatedSystems.ownerId, ownerNumber),
          eq(generatedSystems.conversationId, conversationNumber),
        ),
      )
      .orderBy(desc(generatedSystems.updatedAt))
      .limit(1),
  ]);

  const latestResultSet = resultSetRows[0] ?? null;
  const referencedResultSetIds = referenceRows
    .map((reference) => reference.resultSetId)
    .filter((value): value is string => Boolean(value));
  const candidateResultSetIds = [
    ...new Set([latestResultSet?.id, ...referencedResultSetIds].filter((value): value is string => Boolean(value))),
  ];
  const allReferencedCandidates = candidateResultSetIds.length
    ? await db
        .select()
        .from(discoveryCandidates)
        .where(inArray(discoveryCandidates.resultSetId, candidateResultSetIds))
    : [];
  const candidates = latestResultSet
    ? await db
        .select()
        .from(discoveryCandidates)
        .where(eq(discoveryCandidates.resultSetId, latestResultSet.id))
        .orderBy(discoveryCandidates.position)
    : [];

  const proposalIds = proposalRows.map((proposal) => proposal.id);
  const approvalRows = proposalIds.length
    ? await db
        .select()
        .from(proposalApprovals)
        .where(
          and(
            eq(proposalApprovals.ownerId, input.ownerId),
            inArray(proposalApprovals.proposalId, proposalIds),
          ),
        )
        .orderBy(desc(proposalApprovals.updatedAt))
    : [];

  const latestMessage = latestMessages[0];
  const currentPresentation = presentationFromMessage(latestMessage?.metadata);
  const activeTask =
    taskRows.find((task) => !isTerminalTask(task.status)) ??
    taskRows[0] ??
    null;
  const activeRun =
    runRows.find((run) => !isTerminalRun(run.status)) ??
    runRows[0] ??
    null;
  const activeProposal =
    proposalRows.find((proposal) =>
      ["proposed", "awaiting_input", "awaiting_approval", "authorized"].includes(proposal.status),
    ) ??
    proposalRows[0] ??
    null;
  const approval = activeProposal
    ? approvalRows.find((candidate) => candidate.proposalId === activeProposal.id) ?? null
    : null;

  const activeGoal = activeRun
    ? {
        kind: "runtime_run" as const,
        id: activeRun.id,
        text: activeRun.goal,
        status: activeRun.status,
        taskId: activeRun.taskId,
        runId: activeRun.id,
        presentationVersion: `living:${activeRun.updatedAt.toISOString()}`,
      }
    : activeTask
      ? {
          kind: "runtime_task" as const,
          id: activeTask.id,
          text: activeTask.goal,
          status: activeTask.status,
          taskId: activeTask.id,
          runId: null,
        presentationVersion:
          activeTask.world && "version" in activeTask.world
            ? String(activeTask.world.version)
            : null,
        }
      : null;

  const world = worldRows[0];
  const taskWorld = asRecord(activeTask?.world);
  const worldReference = world
    ? {
        kind: "generated_system" as const,
        id: String(world.id),
        worldKey: world.worldKey,
        version: world.version,
        status: world.status,
      }
    : activeTask?.worldId && taskWorld
      ? {
          kind: "runtime_world" as const,
          id: String(activeTask.worldId),
          worldKey: null,
          version: typeof taskWorld.version === "number" ? taskWorld.version : null,
          status: typeof taskWorld.status === "string" ? taskWorld.status : "unknown",
        }
      : null;

  const activeStatus = statusFromSources(activeTask, activeRun, approval, true);
  const attention = attentionFromSources(activeTask, activeRun, activeProposal, approval);
  const availableCandidateIds = new Set(allReferencedCandidates.map((candidate) => candidate.id));
  const availableRunIds = new Set(runRows.map((run) => run.id));
  const availableTaskIds = new Set(taskRows.map((task) => task.id));
  const availableWorldIds = new Set([
    ...worldRows.map((candidate) => String(candidate.id)),
    ...(activeTask?.worldId ? [String(activeTask.worldId)] : []),
  ]);
  const availableProposalIds = new Set(proposalRows.map((proposal) => proposal.id));
  const selectedEntityReferences = referenceRows
    .filter((reference) => {
      switch (reference.targetKind) {
        case "discovery_candidate":
          return availableCandidateIds.has(reference.targetId);
        case "run":
          return availableRunIds.has(reference.targetId);
        case "runtime_task":
        case "task":
          return availableTaskIds.has(reference.targetId);
        case "world":
        case "generated_system":
        case "runtime_world":
          return availableWorldIds.has(reference.targetId);
        case "execution_proposal":
        case "action":
          return availableProposalIds.has(reference.targetId);
        default:
          return true;
      }
    })
    .map((reference) => ({
      referenceKey: reference.referenceKey,
      targetKind: reference.targetKind,
      targetId: reference.targetId,
      resultSetId: reference.resultSetId,
      position: reference.position,
    }));
  const projection: ActiveWorkspaceProjection = {
    kind: "active_workspace_projection",
    version: 1,
    workspaceId: `conversation:${conversationId}`,
    conversation: projectConversation(conversation),
    activeGoal,
    currentPresentation,
    resultSet: latestResultSet
      ? {
          id: latestResultSet.id,
          version: latestResultSet.version,
          queryText: latestResultSet.queryText,
          sources: [...latestResultSet.sources],
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            position: candidate.position,
            title: candidate.title,
            summary: candidate.summary,
            source: candidate.source,
            canonicalRef: candidate.canonicalRef,
            externalRef: candidate.externalRef,
            attributes: candidate.attributes,
            availability: candidate.availability,
            trust: candidate.trust,
            actionable: [...candidate.actionable],
            provenance: candidate.provenance,
            observedAt: iso(candidate.observedAt),
          })),
        }
      : null,
    selectedEntityReferences,
    activeRun: activeRun
      ? {
          id: activeRun.id,
          goal: activeRun.goal,
          status: activeRun.status,
          taskId: activeRun.taskId,
          bubbleId: activeRun.bubbleId,
          updatedAt: activeRun.updatedAt.toISOString(),
        }
      : null,
    activeAction: activeProposal
      ? {
          id: activeProposal.id,
          intentType: activeProposal.intentType,
          status: activeProposal.status,
          runId: activeProposal.runId,
          targetReferences: activeProposal.targetReferences,
          approvalRequired: activeProposal.approvalRequired,
        }
      : null,
    approval: approval
      ? {
          id: approval.id,
          proposalId: approval.proposalId,
          status: approval.status,
          expiresAt: iso(approval.expiresAt),
          presentationVersion: activeProposal?.version ?? "1",
        }
      : null,
    transactionReference: null,
    worldReference,
    status: activeStatus,
    attention,
    availablePresentationActions: currentPresentation?.actions ?? [],
    updatedAt: latestIso([
      conversation.updatedAt.toISOString(),
      latestMessage?.createdAt.toISOString(),
      activeTask?.updatedAt.toISOString(),
      activeRun?.updatedAt.toISOString(),
      activeProposal?.updatedAt.toISOString(),
      latestResultSet?.createdAt.toISOString(),
      world?.updatedAt.toISOString(),
    ]),
    presentationVersion: currentPresentation
      ? `presentation:${currentPresentation.version}`
      : "presentation:1",
  };

  return ActiveWorkspaceProjectionSchema.parse(projection);
}