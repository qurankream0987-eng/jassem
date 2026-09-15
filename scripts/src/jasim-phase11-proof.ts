/**
 * JASIM Phase 11 provider proofs.
 *
 * These are deliberately real-provider proofs: a provider outage, unavailable
 * credentials, no public source, or failed artifact persistence fails the proof.
 * They never substitute a fixture or provider-shaped success response.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const mode = process.argv[2] ?? "web-research";
const appRoot = path.resolve(process.cwd(), "../canonical/جاسم/app");
const moduleUrl = (relative: string) => pathToFileURL(path.join(appRoot, relative)).href;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function resultPayload(output: Record<string, unknown>): Record<string, unknown> {
  const result = output.result;
  return result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : output;
}

type Runtime = {
  createRuntimeConversation(input: { ownerId: string; title: string }): Promise<{ id: string }>;
  createRuntimeRun(input: {
    ownerId: string; conversationId: string; goal: string; idempotencyKey: string;
    status: "blocked"; requiredCapabilities: string[];
  }): Promise<{ id: string }>;
  seedAuthorizedProposalApproval(input: {
    ownerId: string; runId: string; conversationId: string; fingerprint: string;
    capabilityId: string; normalizedInputs: Record<string, unknown>;
  }): Promise<{ proposalId: string }>;
  resumeApprovedPlan(proposalId: string, ownerId: string): Promise<unknown>;
  executeApprovedRun(runId: string, ownerId: string): Promise<{ status: string }>;
  getRuntimeRun(runId: string, ownerId: string): Promise<{
    status: string;
    events?: Array<{ type: string; payload: Record<string, unknown> }>;
    dag?: Array<{ lastErrorSummary?: string | null }>;
  }>;
  buildRunReceipt(runId: string, ownerId: string): Promise<{
    status: string;
    outputs: Array<{ capabilityId: string; output: Record<string, unknown> }>;
  }>;
  reconcileRunToConversation(runId: string, ownerId: string): Promise<unknown>;
  resolveRuntimeReferences(input: {
    ownerId: string; conversationId: string; content: string;
  }): Promise<{ status: string; references: Array<{ referenceType: string }> }>;
};

async function runCapability(input: {
  runtime: Runtime;
  ownerId: string;
  capabilityId: "web-research" | "image-generation";
  normalizedInputs: Record<string, unknown>;
}): Promise<{ runId: string; conversationId: string; output: Record<string, unknown> }> {
  const fingerprint = `phase11-${randomUUID().replace(/-/g, "")}`;
  const conversation = await input.runtime.createRuntimeConversation({
    ownerId: input.ownerId,
    title: `Phase 11 ${input.capabilityId} proof`,
  });
  const run = await input.runtime.createRuntimeRun({
    ownerId: input.ownerId,
    conversationId: conversation.id,
    goal: `Run ${input.capabilityId} through the trusted DAG`,
    idempotencyKey: fingerprint,
    status: "blocked",
    requiredCapabilities: [input.capabilityId],
  });
  const { proposalId } = await input.runtime.seedAuthorizedProposalApproval({
    ownerId: input.ownerId,
    runId: run.id,
    conversationId: conversation.id,
    fingerprint,
    capabilityId: input.capabilityId,
    normalizedInputs: input.normalizedInputs,
  });
  await input.runtime.resumeApprovedPlan(proposalId, input.ownerId);
  const completed = await input.runtime.executeApprovedRun(run.id, input.ownerId);
  if (completed.status !== "completed") {
    const failedRun = await input.runtime.getRuntimeRun(run.id, input.ownerId);
    throw new Error(
      `${input.capabilityId} run ended as ${completed.status}: ${failedRun.dag?.map((node) => node.lastErrorSummary).filter(Boolean).join("; ") ?? JSON.stringify(failedRun.events?.slice(-3) ?? [])}`,
    );
  }
  const receipt = await input.runtime.buildRunReceipt(run.id, input.ownerId);
  assert(receipt.status === "verified", `${input.capabilityId} receipt is ${receipt.status}`);
  const output = receipt.outputs.find((item) => item.capabilityId === input.capabilityId)?.output;
  assert(output, `${input.capabilityId} receipt has no matching output`);
  await input.runtime.reconcileRunToConversation(run.id, input.ownerId);
  return { runId: run.id, conversationId: conversation.id, output: resultPayload(output) };
}

async function run() {
  const registry = await import(moduleUrl("api/runtime/capability-registry.ts"));
  const runtime = (await import(moduleUrl("api/runtime/jasim-runtime.ts"))) as Runtime;
  const artifacts = await import(moduleUrl("api/runtime/phase11-artifacts.ts"));
  const users = await import(moduleUrl("api/queries/users.ts")) as {
    findUserByUnionId(unionId: string): Promise<{ id: number } | undefined>;
    upsertUser(input: { unionId: string; name: string }): Promise<void>;
  };
  await users.upsertUser({ unionId: "dev:local", name: "JASIM Dev" });
  const devUser = await users.findUserByUnionId("dev:local");
  assert(devUser, "Development user was not available for the owner-scoped proof.");
  const ownerId = String(devUser.id);

  assert(registry.hasTrustedCapability("web-research"), "web-research is not registered");
  assert(registry.hasTrustedCapability("image-generation"), "image-generation is not registered");
  assert(!registry.validateTrustedCapabilityInputs("web-research", {}).valid, "research must require query");
  assert(!registry.validateTrustedCapabilityInputs("image-generation", {}).valid, "image must require prompt");

  if (mode === "security") {
    await assertRejects(
      () => artifacts.createGeneratedArtifactReadUrl("../another-owner/image.png"),
      "artifact path traversal must be rejected",
    );
    await assertRejects(
      () => artifacts.createGeneratedArtifactReadUrl("private/not-jasim.png"),
      "non-runtime artifact path must be rejected",
    );
    console.log("Phase 11 security proof passed.");
    return;
  }

  const web = await runCapability({
    runtime, ownerId, capabilityId: "web-research",
    normalizedInputs: { query: "Replit official documentation", maxResults: 3 },
  });
  assert(web.output.kind === "web-research", "research output kind is invalid");
  assert(Array.isArray(web.output.sources) && web.output.sources.length > 0, "research lacks sources");

  if (mode === "web-research") {
    console.log("Phase 11 web research proof passed.");
    return;
  }

  const image = await runCapability({
    runtime, ownerId, capabilityId: "image-generation",
    normalizedInputs: {
      prompt: "A small abstract desert oasis icon, no text, crisp vector-like style",
      size: "1024x1024",
      quality: "low",
    },
  });
  assert(image.output.kind === "image-generation", "image output kind is invalid");
  const generated = Array.isArray(image.output.images) ? image.output.images[0] as Record<string, unknown> : null;
  assert(generated && typeof generated.objectPath === "string", "image lacks durable artifact path");
  assert(typeof generated.renderUrl === "string" || mode !== "restart", "restart receipt lacks a renewed image URL");

  if (mode === "image-generation") {
    console.log("Phase 11 image-generation proof passed.");
    return;
  }

  if (mode === "cross-capability") {
    const sourceReference = await runtime.resolveRuntimeReferences({
      ownerId, conversationId: web.conversationId, content: "استخدم المصدر الثاني في آخر بحث",
    });
    assert(
      sourceReference.references.some((reference) => reference.referenceType === "source"),
      "source-two reference did not resolve within the owner scope",
    );
    console.log("Phase 11 cross-capability proof passed.");
    return;
  }

  if (mode === "restart") {
    const reloadedRuntime = (await import(`${moduleUrl("api/runtime/jasim-runtime.ts")}?reload=${randomUUID()}`)) as Runtime;
    const receipt = await reloadedRuntime.buildRunReceipt(image.runId, ownerId);
    const reloadedImage = receipt.outputs.find((item) => item.capabilityId === "image-generation")?.output.images;
    assert(Array.isArray(reloadedImage) && reloadedImage.length > 0, "image artifact did not survive runtime reload");
    console.log("Phase 11 restart proof passed.");
    return;
  }

  throw new Error(`Unknown Phase 11 proof mode: ${mode}`);
}

async function assertRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

run().catch((error) => {
  console.error(`Phase 11 ${mode} proof FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
});