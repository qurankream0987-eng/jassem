import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  conversations,
  discoveryCandidates,
  discoveryResultSets,
  executionProposals,
  generatedSystems,
  messages,
  proposalApprovals,
  referenceBindings,
  runtimeTasks,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let getActiveWorkspaceProjection: typeof import("../../api/runtime/active-workspace-projection").getActiveWorkspaceProjection;

const OWNER_ID = "42";

beforeAll(async () => {
  handle = await getTestDb();
  ({ getActiveWorkspaceProjection } = await import(
    "../../api/runtime/active-workspace-projection"
  ));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE
      proposal_approvals,
      execution_proposals,
      runtime_tasks,
      reference_bindings,
      discovery_candidates,
      discovery_result_sets,
      generated_systems,
      messages,
      conversations
    CASCADE
  `));
});

describe("Smart UI Task 4A active workspace projection", () => {
  it("projects active context without replacing canonical identity", async () => {
    const [conversation] = await handle.db
      .insert(conversations)
      .values({ userId: Number(OWNER_ID), title: "Active context", status: "active" })
      .returning();

    const presentation = {
      primitive: "APPROVAL" as const,
      version: 1 as const,
      title: "Confirm",
      data: { summary: "A trusted action is ready." },
      actions: [{ intent: "approve" as const, label: "Approve", requiresApproval: true }],
    };
    await handle.db.insert(messages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: "A trusted action is ready.",
      ownerId: OWNER_ID,
      outputKind: "structured_result",
      metadata: { presentation },
    });

    const [task] = await handle.db
      .insert(runtimeTasks)
      .values({
        userId: Number(OWNER_ID),
        conversationId: conversation.id,
        goal: "Complete the active goal",
        status: "running",
        world: {
          id: "runtime-world-1",
          version: 1,
          taskDNA: {
            objective: "Complete the active goal",
            interpretationSource: "deterministic-baseline",
            unresolved: [],
          },
          plan: { status: "running", steps: [] },
          executionContext: [],
        },
        actions: [],
      })
      .returning();

    const [proposal] = await handle.db
      .insert(executionProposals)
      .values({
        ownerId: OWNER_ID,
        conversationId: String(conversation.id),
        intentType: "apply_change",
        targetReferences: [{ kind: "entity", id: "entity-1" }],
        capabilityId: "trusted-capability",
        capabilityVersion: "1",
        normalizedInputs: { entityId: "entity-1" },
        riskLevel: "high",
        sideEffectType: "write",
        policyContext: {},
        policyDecision: "allow_with_approval",
        approvalRequired: true,
        fingerprint: "fingerprint-1",
        status: "awaiting_approval",
        dependencies: [],
      })
      .returning();

    await handle.db.insert(proposalApprovals).values({
      proposalId: proposal.id,
      ownerId: OWNER_ID,
      executionFingerprint: proposal.fingerprint,
      status: "pending",
    });

    const [resultSet] = await handle.db
      .insert(discoveryResultSets)
      .values({
        id: "result-set-stable",
        ownerId: OWNER_ID,
        conversationId: String(conversation.id),
        queryText: "show candidates",
        sources: ["JASIM_INTERNAL"],
      })
      .returning();
    const [candidate] = await handle.db
      .insert(discoveryCandidates)
      .values({
        id: "candidate-stable",
        resultSetId: resultSet.id,
        position: 1,
        source: "JASIM_INTERNAL",
        title: "Candidate one",
        summary: "A stable candidate.",
        attributes: { score: 1 },
        trust: "canonical_internal",
        actionable: ["select"],
        provenance: { source: "test" },
      })
      .returning();

    await handle.db.insert(referenceBindings).values([
      {
        id: `ref-valid-${randomUUID()}`,
        ownerId: OWNER_ID,
        conversationId: String(conversation.id),
        referenceKey: "ordinal:1",
        targetKind: "discovery_candidate",
        targetId: candidate.id,
        resultSetId: resultSet.id,
        position: 1,
      },
      {
        id: `ref-unavailable-${randomUUID()}`,
        ownerId: OWNER_ID,
        conversationId: String(conversation.id),
        referenceKey: "ordinal:2",
        targetKind: "discovery_candidate",
        targetId: "candidate-no-longer-available",
        resultSetId: resultSet.id,
        position: 2,
      },
    ]);

    await handle.db.insert(generatedSystems).values({
      ownerId: Number(OWNER_ID),
      conversationId: conversation.id,
      worldKey: "active-world",
      name: "Active world",
      version: "2.0.0",
      status: "active",
    });

    const first = await getActiveWorkspaceProjection({
      ownerId: OWNER_ID,
      conversationId: String(conversation.id),
    });
    const second = await getActiveWorkspaceProjection({
      ownerId: OWNER_ID,
      conversationId: String(conversation.id),
    });

    expect(first.workspaceId).toBe(`conversation:${conversation.id}`);
    expect(first.currentPresentation?.primitive).toBe("APPROVAL");
    expect(first.resultSet?.id).toBe("result-set-stable");
    expect(first.resultSet?.candidates.map((item) => item.id)).toEqual(["candidate-stable"]);
    expect(first.resultSet?.id).toBe(second.resultSet?.id);
    expect(first.selectedEntityReferences).toEqual([
      expect.objectContaining({
        referenceKey: "ordinal:1",
        targetId: "candidate-stable",
      }),
    ]);
    expect(first.selectedEntityReferences.some((ref) => ref.referenceKey === "ordinal:2")).toBe(false);
    expect(first.activeGoal?.id).toBe(task.id);
    expect(first.activeAction?.id).toBe(proposal.id);
    expect(first.approval?.status).toBe("pending");
    expect(first.worldReference).toEqual(
      expect.objectContaining({ kind: "generated_system", worldKey: "active-world" }),
    );
    expect(first.status).toBe("awaiting_approval");
    expect(first.attention).toEqual([
      expect.objectContaining({ kind: "approval_required", sourceId: first.approval?.id }),
    ]);
  });

  it("returns a safe empty projection when no owned conversation exists", async () => {
    const projection = await getActiveWorkspaceProjection({ ownerId: OWNER_ID });
    expect(projection).toMatchObject({
      kind: "active_workspace_projection",
      workspaceId: `owner:${OWNER_ID}:idle`,
      status: "idle",
      conversation: null,
      activeGoal: null,
      selectedEntityReferences: [],
    });
  });
});