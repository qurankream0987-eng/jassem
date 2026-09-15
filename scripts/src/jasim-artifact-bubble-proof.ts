/**
 * Runtime Artifact → Smart Bubble proof.
 *
 * This creates two tiny deterministic PNG fixtures directly in private App
 * Storage. It deliberately never calls an image provider or model gateway.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tinyPngA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const tinyPngB = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl1Jf8AAAAASUVORK5CYII=",
  "base64",
);

async function run() {
  const canonicalRoot = path.resolve(process.cwd(), "../canonical/جاسم/app");
  const runtimeUrl = pathToFileURL(path.join(canonicalRoot, "api/runtime/jasim-runtime.ts")).href;
  const artifactsUrl = pathToFileURL(path.join(canonicalRoot, "api/runtime/phase11-artifacts.ts")).href;
  const databaseUrl = pathToFileURL(path.join(canonicalRoot, "api/queries/connection.ts")).href;
  const schemaUrl = pathToFileURL(path.join(canonicalRoot, "db/schema-runtime.ts")).href;

  const runtime = (await import(runtimeUrl)) as {
    createRuntimeConversation(input: { ownerId: string; title: string }): Promise<{ id: string }>;
    createRuntimeBubble(input: {
      ownerId: string;
      conversationId: string;
      mode: "ephemeral";
      title: string;
      semanticDescription: string;
    }): Promise<{
      bubbleId: string;
      presentation: { presentationVersion: number };
      references: Array<Record<string, unknown>>;
    }>;
    createRuntimeRun(input: {
      ownerId: string;
      goal: string;
      idempotencyKey: string;
    }): Promise<{ id: string }>;
    attachRuntimeArtifactToBubble(input: {
      ownerId: string;
      bubbleId: string;
      sourceRunId: string;
      artifactId: string;
      role: "cover" | "background";
      expectedPresentationVersion: number;
    }): Promise<{
      bubble: {
        presentation: { presentationVersion: number };
        references: Array<Record<string, unknown>>;
      };
      idempotent: boolean;
    }>;
    updateRuntimeBubblePresentation(input: {
      ownerId: string;
      bubbleId: string;
      action: "archive";
      expectedPresentationVersion: number;
    }): Promise<unknown>;
    getRuntimeBubble(bubbleId: string, ownerId: string): Promise<{
      presentation: { presentationVersion: number };
      references: Array<Record<string, unknown>>;
    }>;
    RuntimeAccessError: new (message: string) => Error;
    RuntimeActionError: new (message: string) => Error;
    RuntimeConflictError: new (message: string) => Error;
  };
  const artifacts = (await import(artifactsUrl)) as {
    persistGeneratedImageArtifact(input: {
      ownerId: string;
      runId: string;
      prompt: string;
      bytes: Buffer;
      contentType: "image/png";
    }): Promise<Record<string, unknown>>;
  };
  const { db } = (await import(databaseUrl)) as { db: any };
  const { dagNodes } = (await import(schemaUrl)) as { dagNodes: any };

  const ownerId = "1";
  const conversation = await runtime.createRuntimeConversation({
    ownerId,
    title: "Artifact Bubble Proof",
  });
  const bubble = await runtime.createRuntimeBubble({
    ownerId,
    conversationId: conversation.id,
    mode: "ephemeral",
    title: "Artifact target",
    semanticDescription: "Durable artifact attachment proof",
  });
  const sourceRun = await runtime.createRuntimeRun({
    ownerId,
    goal: "Persisted artifact fixture for attachment proof",
    idempotencyKey: `artifact-bubble-proof-${randomUUID()}`,
  });

  // Persisted artifacts exist before attachment; this is storage-only fixture
  // construction, not a provider image-generation call.
  const firstArtifact = await artifacts.persistGeneratedImageArtifact({
    ownerId,
    runId: sourceRun.id,
    prompt: "proof fixture one",
    bytes: tinyPngA,
    contentType: "image/png",
  });
  const secondArtifact = await artifacts.persistGeneratedImageArtifact({
    ownerId,
    runId: sourceRun.id,
    prompt: "proof fixture two",
    bytes: tinyPngB,
    contentType: "image/png",
  });
  assert(typeof firstArtifact.artifactId === "string", "First artifact fixture must have an ID.");
  assert(typeof secondArtifact.artifactId === "string", "Second artifact fixture must have an ID.");
  assert(firstArtifact.artifactId !== secondArtifact.artifactId, "Fixtures must be distinct.");

  await db.insert(dagNodes).values({
    runId: sourceRun.id,
    ownerId,
    nodeKey: `artifact-proof-${randomUUID().slice(0, 12)}`,
    capabilityId: "artifact-proof-fixture",
    status: "COMPLETED",
    output: {
      kind: "image-generation",
      images: [firstArtifact, secondArtifact],
    },
  });

  // Attach: private object bytes / provider URLs are absent from Bubble state.
  const attached = await runtime.attachRuntimeArtifactToBubble({
    ownerId,
    bubbleId: bubble.bubbleId,
    sourceRunId: sourceRun.id,
    artifactId: firstArtifact.artifactId,
    role: "cover",
    expectedPresentationVersion: bubble.presentation.presentationVersion,
  });
  assert(!attached.idempotent, "First attachment must apply a mutation.");
  assert(attached.bubble.presentation.presentationVersion === 2, "Attachment must increment presentationVersion exactly once.");
  assert(attached.bubble.references.length === 1, "Attachment must create one durable reference.");
  const attachedRef = attached.bubble.references[0]!;
  assert(attachedRef.artifactId === firstArtifact.artifactId, "Attached reference must preserve artifact identity.");
  assert(attachedRef.sourceRunId === sourceRun.id, "Attached reference must preserve source run.");
  assert(typeof attachedRef.renderPath === "string" && attachedRef.renderPath.startsWith("/api/runtime/generated-image/"), "Projection must expose the protected preview route.");
  assert(!("objectPath" in attachedRef) && !("renderUrl" in attachedRef), "Bubble state must not contain storage paths or temporary URLs.");

  // Idempotent replay succeeds even when the client retries with its old version.
  const replay = await runtime.attachRuntimeArtifactToBubble({
    ownerId,
    bubbleId: bubble.bubbleId,
    sourceRunId: sourceRun.id,
    artifactId: firstArtifact.artifactId,
    role: "cover",
    expectedPresentationVersion: 1,
  });
  assert(replay.idempotent, "Exact replay must be idempotent.");
  assert(replay.bubble.presentation.presentationVersion === 2, "Idempotent replay must not increment presentationVersion.");

  // Same presentation slot replaces the old reference atomically.
  const replaced = await runtime.attachRuntimeArtifactToBubble({
    ownerId,
    bubbleId: bubble.bubbleId,
    sourceRunId: sourceRun.id,
    artifactId: secondArtifact.artifactId,
    role: "cover",
    expectedPresentationVersion: 2,
  });
  assert(!replaced.idempotent, "Replacement must apply a mutation.");
  assert(replaced.bubble.presentation.presentationVersion === 3, "Replacement must increment presentationVersion once.");
  assert(replaced.bubble.references.length === 1, "Replacement must not duplicate the slot.");
  assert(replaced.bubble.references[0]?.artifactId === secondArtifact.artifactId, "Replacement must point at the new artifact.");

  let staleRejected = false;
  try {
    await runtime.attachRuntimeArtifactToBubble({
      ownerId,
      bubbleId: bubble.bubbleId,
      sourceRunId: sourceRun.id,
      artifactId: firstArtifact.artifactId,
      role: "background",
      expectedPresentationVersion: 1,
    });
  } catch (error) {
    staleRejected =
      error instanceof runtime.RuntimeConflictError ||
      (error instanceof Error && error.message.includes("changed"));
  }
  assert(staleRejected, "Stale presentation version must be rejected.");

  let crossOwnerRejected = false;
  try {
    await runtime.attachRuntimeArtifactToBubble({
      ownerId: "999999",
      bubbleId: bubble.bubbleId,
      sourceRunId: sourceRun.id,
      artifactId: secondArtifact.artifactId,
      role: "background",
      expectedPresentationVersion: 3,
    });
  } catch (error) {
    crossOwnerRejected =
      error instanceof runtime.RuntimeAccessError ||
      (error instanceof Error && error.message.includes("not found"));
  }
  assert(crossOwnerRejected, "Cross-owner artifact or Bubble attachment must be blocked.");

  // A fresh read models a restart: the durable reference remains, while the
  // protected projection path is derived again rather than persisted.
  const reloaded = await runtime.getRuntimeBubble(bubble.bubbleId, ownerId);
  assert(reloaded.references.length === 1, "Attachment must survive a fresh Runtime read.");
  assert(reloaded.references[0]?.artifactId === secondArtifact.artifactId, "Fresh projection must resolve the replaced artifact.");
  assert(typeof reloaded.references[0]?.renderPath === "string", "Web and mobile share the same protected projection field.");

  await runtime.updateRuntimeBubblePresentation({
    ownerId,
    bubbleId: bubble.bubbleId,
    action: "archive",
    expectedPresentationVersion: 3,
  });
  let archivedRejected = false;
  try {
    await runtime.attachRuntimeArtifactToBubble({
      ownerId,
      bubbleId: bubble.bubbleId,
      sourceRunId: sourceRun.id,
      artifactId: firstArtifact.artifactId,
      role: "background",
      expectedPresentationVersion: 4,
    });
  } catch (error) {
    archivedRejected =
      error instanceof runtime.RuntimeActionError ||
      (error instanceof Error && error.message.includes("archived"));
  }
  assert(archivedRejected, "Archived Bubbles must reject artifact attachment.");

  console.log("JASIM Runtime Artifact Bubble proof passed (no image provider calls).");
}

run().catch((error) => {
  console.error("JASIM Runtime Artifact Bubble proof FAILED:", error?.message ?? error);
  process.exit(1);
});