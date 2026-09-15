/**
 * JASIM Phase E Proof — Runtime Semantic Events
 *
 * Proves the semantic event emission pipeline:
 *   1. applyBubbleMutation  → emits BUBBLE_MUTATION_APPLIED (atomic, in transaction)
 *   2. generateBubbleMutation → emits BUBBLE_MUTATION_GENERATED (fire-and-forget)
 *   3. listRuntimeSemanticEvents → returns emitted events with correct fields
 *   4. conversationId correlation → events filterable by correlationId
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
    }): Promise<{ bubbleId: string }>;

    generateBubbleMutation(
      bubbleId: string,
      ownerId: string,
      nlInstruction: string,
    ): Promise<{
      id: string;
      mutationType: string;
      fromVersion: string;
      newSchema: Record<string, unknown>;
      estimatedImpact: string;
      description: string;
    }>;

    applyBubbleMutation(
      bubbleId: string,
      ownerId: string,
      changeset: unknown,
      appliedBy: string,
    ): Promise<{
      id: string;
      schemaVersion: string;
    }>;

    listRuntimeSemanticEvents(input: {
      ownerId: string;
      eventType?: string;
      conversationId?: string;
      limit?: number;
    }): Promise<
      Array<{
        id: number;
        type: string;
        source: string;
        payload: Record<string, unknown>;
        ownerId: string | null;
        correlationId: string | null;
        message: string | null;
        createdAt: string;
      }>
    >;

    createRuntimeSemanticEvent(input: {
      type: string;
      ownerId: string;
      conversationId?: string;
      bubbleId?: string;
      payload: Record<string, unknown>;
      message?: string;
    }): Promise<void>;
  };

  const TEST_USER_ID = "1";

  // ── Step 1: Create conversation + bubble ─────────────────────────────────
  const conversation = await runtime.createRuntimeConversation({
    ownerId: TEST_USER_ID,
    title: "Phase E Proof Conversation",
  });
  assert(conversation.id, "conversation must have id");

  const bubble = await runtime.createRuntimeBubble({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    mode: "ephemeral",
    title: "Phase E Proof Bubble",
    semanticDescription: "Test bubble for event proof",
  });
  assert(bubble.bubbleId, "bubble must have bubbleId");

  // ── Step 2: Generate changeset — emits BUBBLE_MUTATION_GENERATED ─────────
  const changeset = await runtime.generateBubbleMutation(
    bubble.bubbleId,
    TEST_USER_ID,
    "Add a name and email field to this form",
  );
  assert(changeset.id, "Changeset must have id");

  // Wait briefly for fire-and-forget event to persist
  await new Promise((r) => setTimeout(r, 200));

  // ── Step 3: Verify BUBBLE_MUTATION_GENERATED event was emitted ───────────
  const generatedEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "BUBBLE_MUTATION_GENERATED",
    limit: 10,
  });
  const generatedEvent = generatedEvents.find(
    (e) => (e.payload.changesetId as string) === changeset.id,
  );
  assert(
    generatedEvent !== undefined,
    `BUBBLE_MUTATION_GENERATED event not found for changeset ${changeset.id}`,
  );
  assert(
    generatedEvent.source === "jasim-runtime",
    "Event source must be jasim-runtime",
  );
  assert(
    (generatedEvent.payload.bubbleId as string) === bubble.bubbleId,
    "Event payload must include bubbleId",
  );

  // ── Step 4: Apply changeset — emits BUBBLE_MUTATION_APPLIED (atomic) ─────
  const version = await runtime.applyBubbleMutation(
    bubble.bubbleId,
    TEST_USER_ID,
    changeset,
    TEST_USER_ID,
  );
  assert(version.schemaVersion === "schema:1", "Must apply to schema:1");

  // BUBBLE_MUTATION_APPLIED is emitted inside the DB transaction — no delay needed
  const appliedEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "BUBBLE_MUTATION_APPLIED",
    limit: 10,
  });
  const appliedEvent = appliedEvents.find(
    (e) => (e.payload.bubbleId as string) === bubble.bubbleId,
  );
  assert(
    appliedEvent !== undefined,
    "BUBBLE_MUTATION_APPLIED event must exist after applyBubbleMutation",
  );
  assert(
    (appliedEvent.payload.schemaVersion as string) === "schema:1",
    "Applied event must record schemaVersion schema:1",
  );
  assert(
    (appliedEvent.payload.fromVersion as string) === "schema:0",
    "Applied event must record fromVersion schema:0",
  );

  // ── Step 5: Manual event creation — custom semantic event ────────────────
  await runtime.createRuntimeSemanticEvent({
    type: "CONVERSATION_TURN_ROUTED",
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    payload: { outputKind: "text", confidence: 0.9, test: true },
    message: "Test routing event",
  });

  // ── Step 6: Filter events by conversationId (via correlationId) ───────────
  const conversationEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    limit: 10,
  });
  const turnEvent = conversationEvents.find(
    (e) => e.type === "CONVERSATION_TURN_ROUTED",
  );
  assert(
    turnEvent !== undefined,
    "CONVERSATION_TURN_ROUTED event must be retrievable by conversationId",
  );
  assert(
    (turnEvent.payload.test as boolean) === true,
    "Event payload must be correctly stored",
  );

  console.log("JASIM Phase E — Runtime Semantic Events proof passed.");
}

run().catch((err) => {
  console.error("JASIM Phase E proof FAILED:", err.message ?? err);
  process.exit(1);
});
