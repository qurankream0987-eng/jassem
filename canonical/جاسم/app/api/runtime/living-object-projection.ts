import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  bubbles,
  generatedSystems,
  runs,
  runtimeTasks,
} from "@db/schema";
import {
  LivingObjectsProjectionSchema,
  type LivingObjectAction,
  type LivingObjectAttentionLevel,
  type LivingObjectProjection,
  type LivingObjectReference,
  type LivingObjectStatus,
  type LivingObjectsProjection,
} from "./presentation-fabric";
import type { RuntimeActionRecord, RuntimeWorldRecord } from "@db/schema-runtime";

type TaskRow = typeof runtimeTasks.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type WorldRow = typeof generatedSystems.$inferSelect;
type BubbleRow = typeof bubbles.$inferSelect;

type LivingCandidate = {
  key: string;
  reference: LivingObjectReference;
  relatedReferences: LivingObjectReference[];
  semanticType: LivingObjectProjection["semanticType"];
  title: string;
  summary: string;
  status: string;
  continuity: "ephemeral" | "evolving" | "persistent" | null;
  updatedAt: Date;
  createdAt: Date;
  actions: RuntimeActionRecord[];
  sourcePriority: number;
};

type LivingGroup = {
  candidates: LivingCandidate[];
};

const ONGOING_STATUSES = new Set([
  "pending",
  "planning",
  "running",
  "paused",
  "waiting",
  "waiting_input",
  "awaiting_input",
  "waiting_approval",
  "awaiting_approval",
  "created",
  "ready",
  "scheduled",
  "verifying",
  "blocked",
]);

function iso(value: Date): string {
  return value.toISOString();
}

function safeText(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function worldRecord(value: RuntimeWorldRecord | null): RuntimeWorldRecord | null {
  return value && typeof value === "object" ? value : null;
}

function worldContinuity(value: RuntimeWorldRecord | null): "ephemeral" | "evolving" {
  if (!value || typeof value !== "object") return "ephemeral";
  const record = value as unknown as Record<string, unknown>;
  if (record.continuity === "evolving") return "evolving";
  const nestedWorld = record.world;
  if (
    nestedWorld &&
    typeof nestedWorld === "object" &&
    !Array.isArray(nestedWorld) &&
    (nestedWorld as Record<string, unknown>).continuity === "evolving"
  ) {
    return "evolving";
  }
  return "ephemeral";
}

function groupKeyForReference(reference: LivingObjectReference, links: {
  taskId?: string | null;
  worldId?: string | null;
  bubbleId?: string | null;
} = {}): string {
  if (links.taskId) return `task:${links.taskId}`;
  if (links.worldId) return `world:${links.worldId}`;
  if (links.bubbleId) return `bubble:${links.bubbleId}`;
  return `${reference.kind}:${reference.id}`;
}

function addCandidate(groups: Map<string, LivingGroup>, candidate: LivingCandidate): void {
  const group = groups.get(candidate.key);
  if (group) {
    group.candidates.push(candidate);
  } else {
    groups.set(candidate.key, { candidates: [candidate] });
  }
}

function normalizedStatus(status: string, semanticType: LivingObjectProjection["semanticType"]): LivingObjectStatus {
  switch (status) {
    case "awaiting_input":
    case "waiting_input":
      return "WAITING_USER";
    case "awaiting_approval":
    case "waiting_approval":
      return "WAITING_APPROVAL";
    case "blocked":
      return "BLOCKED";
    case "failed":
      return "FAILED";
    case "completed":
      return "COMPLETED";
    case "verifying":
      return "VERIFYING";
    case "monitoring":
      return "MONITORING";
    case "running":
    case "created":
    case "ready":
    case "scheduled":
      return "RUNNING";
    case "pending":
    case "planning":
    case "paused":
    case "waiting":
      return "WAITING";
    case "active":
      return semanticType === "world" || semanticType === "bubble" ? "ACTIVE" : "RUNNING";
    default:
      return "ACTIVE";
  }
}

function attentionForStatus(status: LivingObjectStatus): {
  level: LivingObjectAttentionLevel;
  reason: string | null;
} {
  switch (status) {
    case "WAITING_USER":
      return { level: "ACTION_REQUIRED", reason: "This ongoing process is waiting for user input." };
    case "WAITING_APPROVAL":
      return { level: "APPROVAL_REQUIRED", reason: "An ongoing process is waiting for approval." };
    case "BLOCKED":
      return { level: "BLOCKED", reason: "This ongoing process is blocked and needs recovery." };
    case "FAILED":
      return { level: "FAILED", reason: "This durable process failed and remains available for review." };
    case "COMPLETED":
      return { level: "COMPLETED", reason: "This durable process completed recently." };
    case "RUNNING":
    case "VERIFYING":
    case "MONITORING":
      return { level: "NONE", reason: null };
    default:
      return { level: "INFO", reason: "This durable object remains available in JASIM." };
  }
}

function attentionRank(level: LivingObjectAttentionLevel): number {
  switch (level) {
    case "APPROVAL_REQUIRED":
      return 0;
    case "ACTION_REQUIRED":
      return 1;
    case "BLOCKED":
      return 2;
    case "FAILED":
      return 3;
    case "INFO":
      return 4;
    case "NONE":
      return 5;
    case "COMPLETED":
      return 6;
  }
}

function isEligible(group: LivingGroup): boolean {
  return group.candidates.some((candidate) => {
    const status = candidate.status.toLowerCase();
    return (
      ONGOING_STATUSES.has(status) ||
      status === "failed" ||
      (candidate.continuity === "evolving" || candidate.continuity === "persistent")
    ) && status !== "cancelled" && status !== "archived";
  });
}

function actionFor(
  intent: LivingObjectAction["intent"],
  label: string,
  reference: LivingObjectReference,
  requiresApproval = false,
): LivingObjectAction {
  return { intent, label, reference, ...(requiresApproval ? { requiresApproval } : {}) };
}

function progressFromActions(actions: RuntimeActionRecord[]): LivingObjectProjection["progress"] {
  if (actions.length === 0) return undefined;
  const completed = actions.filter((action) => action.status === "completed").length;
  return {
    completed,
    total: actions.length,
    ratio: completed / actions.length,
  };
}

function projectGroup(group: LivingGroup): LivingObjectProjection {
  const candidates = [...group.candidates].sort((left, right) => {
    const updated = right.updatedAt.getTime() - left.updatedAt.getTime();
    return updated || left.sourcePriority - right.sourcePriority;
  });
  const primary = [...candidates].sort((left, right) => left.sourcePriority - right.sourcePriority)[0]!;
  const latest = candidates[0]!;
  const status = normalizedStatus(latest.status, primary.semanticType);
  const attention = attentionForStatus(status);
  const relatedReferences = candidates
    .flatMap((candidate) => [candidate.reference, ...candidate.relatedReferences])
    .filter((reference, index, references) =>
      references.findIndex((item) => item.kind === reference.kind && item.id === reference.id) === index,
    )
    .sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    )
    .slice(0, 20);
  const completion =
    status === "FAILED" ? "failed" : status === "COMPLETED" ? "completed" : "not_complete";
  const durability =
    completion === "completed"
      ? "recently_completed"
      : primary.continuity === "evolving" || primary.continuity === "persistent"
        ? "persistent"
        : "ongoing";
  const primaryAction =
    status === "WAITING_APPROVAL"
      ? actionFor("approve", "Approve", primary.reference, true)
      : status === "WAITING_USER"
        ? actionFor("review", "Review", primary.reference)
        : status === "COMPLETED" || status === "FAILED"
          ? actionFor("review", "Review", primary.reference)
          : actionFor("open", "Open", primary.reference);

  return {
    id: `living:${primary.reference.kind}:${primary.reference.id}`,
    underlyingReference: primary.reference,
    relatedReferences,
    semanticType: primary.semanticType,
    title: safeText(primary.title, "Ongoing JASIM process"),
    summary: safeText(primary.summary, "A durable process remains available in JASIM."),
    status,
    attention,
    progress: progressFromActions(
      primary.actions.length > 0 ? primary.actions : latest.actions,
    ),
    primaryAction,
    secondaryActions: [],
    updatedAt: iso(latest.updatedAt),
    createdAt: iso(
      candidates.reduce(
        (earliest, candidate) =>
          candidate.createdAt.getTime() < earliest.getTime() ? candidate.createdAt : earliest,
        primary.createdAt,
      ),
    ),
    presentationVersion: `living:${latest.updatedAt.toISOString()}`,
    durability,
    completion,
  };
}

export function buildLivingObjectsProjection(input: {
  tasks: TaskRow[];
  runs: RunRow[];
  worlds: WorldRow[];
  bubbles: BubbleRow[];
  limit: number;
  generatedAt?: Date;
}): LivingObjectsProjection {
  const groups = new Map<string, LivingGroup>();
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const taskByWorldId = new Map(
    input.tasks
      .filter((task) => task.worldId !== null)
      .map((task) => [String(task.worldId), task]),
  );
  const taskByBubbleId = new Map(
    input.tasks
      .filter((task) => task.bubbleId !== null)
      .map((task) => [String(task.bubbleId), task]),
  );

  for (const task of input.tasks) {
    const reference: LivingObjectReference = { kind: "runtime_task", id: task.id };
    const world = worldRecord(task.world);
    addCandidate(groups, {
      key: groupKeyForReference(reference, {
        taskId: task.id,
        worldId: task.worldId === null ? null : String(task.worldId),
        bubbleId: task.bubbleId === null ? null : String(task.bubbleId),
      }),
      reference,
      relatedReferences: [
        ...(task.worldId === null
          ? []
          : [{ kind: "generated_system" as const, id: String(task.worldId) }]),
        ...(task.bubbleId === null
          ? []
          : [{ kind: "smart_bubble" as const, id: String(task.bubbleId) }]),
      ],
      semanticType: "process",
      title: task.goal,
      summary: task.goal,
      status: task.status,
      continuity: worldContinuity(world),
      updatedAt: task.updatedAt,
      createdAt: task.createdAt,
      actions: task.actions ?? [],
      sourcePriority: 0,
    });
  }

  for (const run of input.runs) {
    const reference: LivingObjectReference = { kind: "runtime_run", id: run.id };
    const linkedTask = run.taskId ? taskById.get(run.taskId) : undefined;
    addCandidate(groups, {
      key: groupKeyForReference(reference, {
        taskId: run.taskId,
        bubbleId: run.bubbleId,
      }),
      reference,
      relatedReferences: [
        ...(run.taskId ? [{ kind: "runtime_task" as const, id: run.taskId }] : []),
        ...(run.bubbleId ? [{ kind: "smart_bubble" as const, id: run.bubbleId }] : []),
      ],
      semanticType: "process",
      title: run.goal,
      summary: run.goal,
      status: run.status,
      continuity: worldContinuity(linkedTask?.world ?? null),
      updatedAt: run.updatedAt,
      createdAt: run.createdAt,
      actions: [],
      sourcePriority: linkedTask ? 1 : 2,
    });
  }

  for (const world of input.worlds) {
    const reference: LivingObjectReference = { kind: "generated_system", id: String(world.id) };
    const linkedTask = taskByWorldId.get(String(world.id));
    addCandidate(groups, {
      key: groupKeyForReference(reference, {
        taskId: linkedTask?.id ?? null,
        worldId: String(world.id),
      }),
      reference,
      relatedReferences: linkedTask
        ? [{ kind: "runtime_task" as const, id: linkedTask.id }]
        : [],
      semanticType: "world",
      title: world.name,
      summary: safeText(world.description, world.name),
      status: world.status,
      continuity: world.continuity,
      updatedAt: world.updatedAt,
      createdAt: world.createdAt,
      actions: [],
      sourcePriority: 0,
    });
  }

  for (const bubble of input.bubbles) {
    if (bubble.mode !== "persistent" || bubble.status !== "active") continue;
    const reference: LivingObjectReference = { kind: "smart_bubble", id: String(bubble.id) };
    const linkedTask = taskByBubbleId.get(String(bubble.id));
    const linkedWorld = input.worlds.some((world) => world.id === bubble.worldId)
      ? String(bubble.worldId)
      : null;
    addCandidate(groups, {
      key: groupKeyForReference(reference, {
        taskId: linkedTask?.id ?? null,
        worldId: linkedTask ? null : linkedWorld,
        bubbleId: String(bubble.id),
      }),
      reference,
      relatedReferences: [
        ...(linkedTask === undefined
          ? []
          : [{ kind: "runtime_task" as const, id: linkedTask.id }]),
        ...(linkedWorld === null
          ? []
          : [{ kind: "generated_system" as const, id: linkedWorld }]),
      ],
      semanticType: "bubble",
      title: bubble.label,
      summary: safeText(bubble.semanticDescription, bubble.label),
      status: bubble.status,
      continuity: "persistent",
      updatedAt: bubble.updatedAt,
      createdAt: bubble.createdAt,
      actions: [],
      sourcePriority: 3,
    });
  }

  const objects = [...groups.values()]
    .filter(isEligible)
    .map(projectGroup)
    .sort((left, right) => {
      const attention = attentionRank(left.attention.level) - attentionRank(right.attention.level);
      if (attention !== 0) return attention;
      const updated = right.updatedAt.localeCompare(left.updatedAt);
      return updated || left.id.localeCompare(right.id);
    })
    .slice(0, input.limit);

  return LivingObjectsProjectionSchema.parse({
    kind: "living_objects_projection",
    version: 1,
    objects,
    limit: input.limit,
    generatedAt: iso(input.generatedAt ?? new Date()),
  });
}

export async function getLivingObjectsProjection(input: {
  ownerId: string;
  limit?: number;
}): Promise<LivingObjectsProjection> {
  const ownerId = Number(input.ownerId);
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    return buildLivingObjectsProjection({
      tasks: [],
      runs: [],
      worlds: [],
      bubbles: [],
      limit,
    });
  }

  const [tasks, runRows, worlds, bubbleRows] = await Promise.all([
    db
      .select()
      .from(runtimeTasks)
      .where(eq(runtimeTasks.userId, ownerId))
      .orderBy(desc(runtimeTasks.updatedAt))
      .limit(100),
    db
      .select()
      .from(runs)
      .where(eq(runs.ownerId, input.ownerId))
      .orderBy(desc(runs.updatedAt))
      .limit(100),
    db
      .select()
      .from(generatedSystems)
      .where(
        and(
          eq(generatedSystems.ownerId, ownerId),
          inArray(generatedSystems.status, ["draft", "generating", "active", "paused"]),
        ),
      )
      .orderBy(desc(generatedSystems.updatedAt))
      .limit(100),
    db
      .select()
      .from(bubbles)
      .where(and(eq(bubbles.userId, ownerId), eq(bubbles.status, "active")))
      .orderBy(desc(bubbles.updatedAt))
      .limit(100),
  ]);

  return buildLivingObjectsProjection({
    tasks,
    runs: runRows,
    worlds,
    bubbles: bubbleRows,
    limit,
  });
}