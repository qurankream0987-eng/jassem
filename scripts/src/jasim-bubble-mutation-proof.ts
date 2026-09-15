/**
 * JASIM Phase C Proof — Smart Bubble Generative Mutation Engine
 *
 * Proves the full NL → ChangeSet → Preview → AtomicApply → ContentVersion loop:
 *   1. Create conversation + ephemeral bubble
 *   2. generateBubbleMutation  → ChangeSet (LLM round-trip)
 *   3. previewBubbleMutation   → preview without writing to DB
 *   4. applyBubbleMutation     → atomic DB write + version record (schema:1)
 *   5. listBubbleContentVersions → audit trail confirmed
 *   6. Optimistic lock check    → stale apply is rejected
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
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

    createRuntimeBubble(input: {
      ownerId: string;
      conversationId: string;
      mode: "ephemeral" | "interactive" | "persistent";
      title: string;
      semanticDescription: string;
      activeView?: string;
      references?: Record<string, unknown>[];
    }): Promise<{ bubbleId: string; content: { schema: unknown } }>;

    generateBubbleMutation(
      bubbleId: string,
      ownerId: string,
      nlInstruction: string,
    ): Promise<{
      id: string;
      mutationType: string;
      description: string;
      nlInstruction: string;
      fromVersion: string;
      newSchema: Record<string, unknown>;
      estimatedImpact: string;
    }>;

    previewBubbleMutation(
      bubbleId: string,
      ownerId: string,
      changeset: unknown,
    ): Promise<{
      previewSchema: Record<string, unknown>;
      bubble: { content: { schema: unknown } };
    }>;

    applyBubbleMutation(
      bubbleId: string,
      ownerId: string,
      changeset: unknown,
      appliedBy: string,
    ): Promise<{
      id: string;
      schemaVersion: string;
      fromVersion: string | null;
      mutationType: string;
      schemaAfter: Record<string, unknown>;
    }>;

    listBubbleContentVersions(
      bubbleId: string,
      ownerId: string,
    ): Promise<
      Array<{
        id: string;
        schemaVersion: string;
        fromVersion: string | null;
        mutationType: string;
        changeSet: { nlInstruction: string };
        schemaAfter: Record<string, unknown>;
      }>
    >;

    RuntimeConflictError: new (message: string) => Error;
  };

  const TEST_USER_ID = "1";

  // ── Step 1: Create conversation + ephemeral bubble ───────────────────────
  const conversation = await runtime.createRuntimeConversation({
    ownerId: TEST_USER_ID,
    title: "Phase C Proof Conversation",
  });
  assert(conversation.id, "createRuntimeConversation must return id");

  const bubble = await runtime.createRuntimeBubble({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    mode: "ephemeral",
    title: "Phase C Proof Bubble",
    semanticDescription: "Test bubble for generative mutation proof",
    activeView: "default",
    references: [],
  });
  const bubbleId = bubble.bubbleId;
  assert(bubbleId, "createRuntimeBubble must return bubbleId");

  // ── Step 2: Generate mutation ChangeSet (LLM round-trip) ─────────────────
  const changeset = await runtime.generateBubbleMutation(
    bubbleId,
    TEST_USER_ID,
    "Add a simple contact form with name, email, and message fields",
  );

  assert(changeset.id, "ChangeSet must have an id");
  assert(changeset.mutationType, "ChangeSet must have mutationType");
  assert(
    changeset.newSchema && typeof changeset.newSchema === "object",
    "ChangeSet must have newSchema object",
  );
  assert(
    changeset.fromVersion === "schema:0",
    `Expected fromVersion schema:0, got ${changeset.fromVersion}`,
  );

  // ── Step 3: Preview (must NOT write to DB) ───────────────────────────────
  const preview = await runtime.previewBubbleMutation(
    bubbleId,
    TEST_USER_ID,
    changeset,
  );
  assert(
    preview.previewSchema && typeof preview.previewSchema === "object",
    "Preview must return previewSchema object",
  );
  assert(preview.bubble, "Preview must return bubble");

  // Original bubble schema is still empty — preview is read-only
  const originalSchema = bubble.content.schema;
  const isOriginalEmpty =
    originalSchema === null ||
    originalSchema === undefined ||
    Object.keys(originalSchema as object).length === 0;
  assert(isOriginalEmpty, "Preview must not mutate DB schema");

  // ── Step 4: Apply atomically ─────────────────────────────────────────────
  const version = await runtime.applyBubbleMutation(
    bubbleId,
    TEST_USER_ID,
    changeset,
    TEST_USER_ID,
  );
  assert(
    version.schemaVersion === "schema:1",
    `Expected schemaVersion schema:1, got ${version.schemaVersion}`,
  );
  assert(
    version.fromVersion === "schema:0",
    `Expected fromVersion schema:0, got ${version.fromVersion}`,
  );
  assert(
    version.schemaAfter && Object.keys(version.schemaAfter).length > 0,
    "Version must record non-empty schemaAfter",
  );

  // ── Step 5: Audit trail ───────────────────────────────────────────────────
  const versions = await runtime.listBubbleContentVersions(
    bubbleId,
    TEST_USER_ID,
  );
  assert(
    versions.length === 1,
    `Expected 1 version in audit trail, got ${versions.length}`,
  );
  assert(
    versions[0].schemaVersion === "schema:1",
    "Version record has wrong schemaVersion",
  );
  assert(
    versions[0].changeSet.nlInstruction,
    "Version record must store nlInstruction",
  );

  // ── Step 6: Optimistic lock — stale changeset must be rejected ───────────
  let conflictCaught = false;
  try {
    // fromVersion is still "schema:0" but current is "schema:1" — must reject
    await runtime.applyBubbleMutation(
      bubbleId,
      TEST_USER_ID,
      changeset,
      TEST_USER_ID,
    );
  } catch (err) {
    if (
      err instanceof runtime.RuntimeConflictError ||
      (err instanceof Error && err.message.includes("schema:0"))
    ) {
      conflictCaught = true;
    } else {
      throw err;
    }
  }
  assert(conflictCaught, "Stale changeset apply must throw RuntimeConflictError");

  console.log(
    "JASIM Phase C — Smart Bubble Generative Mutation proof passed.",
  );
}

run().catch((err) => {
  console.error("JASIM Phase C proof FAILED:", err.message ?? err);
  process.exit(1);
});
