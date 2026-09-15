import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RequiredCorePatchGates, type CorePatchGateName } from "@contracts/core-evolution";
import { MemoryCoreEvolutionRepository } from "../../api/core/core-evolution-repository";
import { CoreEvolutionService, type CorePatchSourceProvider } from "../../api/core/core-evolution-service";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function sourceProvider(id = "dna_core_patch_1", sourceDigest = sha("patch"), status = "approved"): CorePatchSourceProvider {
  return {
    async get(candidateId) {
      if (candidateId !== id) return undefined;
      return { id, kind: "core_patch", sourceDigest, artifactRef: `dna-artifact:sha256:${sourceDigest}`, status };
    },
  };
}

async function fixture() {
  const repository = new MemoryCoreEvolutionRepository();
  const service = new CoreEvolutionService(repository, sourceProvider());
  await service.registerBaseline({
    id: "kernel_1_0_0",
    version: "1.0.0",
    kernelDigest: sha("kernel"),
    manifestDigest: sha("manifest"),
    testSuiteDigest: sha("tests"),
    status: "active",
    metadata: { suite: "baseline" },
    createdBy: "release-admin",
    createdAt: new Date().toISOString(),
  });
  const candidate = await service.submit({
    dnaCandidateId: "dna_core_patch_1",
    baseBaselineId: "kernel_1_0_0",
    targetVersion: "1.1.0",
    sourceDigest: sha("patch"),
    title: "Planner safety boundary",
    summary: "Keep irreversible actions behind explicit approvals.",
    scope: ["api/core/planner.ts"],
    declaredEffects: ["changes planning policy"],
    testPlan: ["replay approval cases"],
    rollbackPlan: ["route all traffic to kernel 1.0.0"],
    createdBy: "core-developer",
  });
  return { repository, service, candidate };
}

describe("Core Evolution Lab foundation", () => {
  it("requires an immutable baseline before accepting a core patch", async () => {
    const service = new CoreEvolutionService(new MemoryCoreEvolutionRepository(), sourceProvider("dna_missing_baseline"));
    await expect(service.submit({
      dnaCandidateId: "dna_missing_baseline",
      baseBaselineId: "missing",
      targetVersion: "1.1.0",
      sourceDigest: sha("patch"),
      title: "Missing baseline",
      summary: "Must fail closed.",
      scope: ["api/core/runtime.ts"],
      declaredEffects: [],
      testPlan: ["test"],
      rollbackPlan: ["rollback"],
      createdBy: "developer",
    })).rejects.toMatchObject({ code: "BASELINE_MISSING" });
  });

  it("stores a critical, inert candidate and an append-only submission event", async () => {
    const { repository, candidate } = await fixture();
    expect(candidate.status).toBe("submitted");
    expect(candidate.risk).toBe("critical");
    expect(candidate.requiredGates).toEqual(RequiredCorePatchGates);
    const events = await repository.listEvents(candidate.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "submitted", nextStatus: "submitted" });
    expect(events[0].eventDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unapproved or digest-mismatched DNA sources", async () => {
    const repository = new MemoryCoreEvolutionRepository();
    const baselineService = new CoreEvolutionService(repository, sourceProvider());
    await baselineService.registerBaseline({
      id: "kernel_1_0_0",
      version: "1.0.0",
      kernelDigest: sha("kernel"),
      manifestDigest: sha("manifest"),
      testSuiteDigest: sha("tests"),
      status: "active",
      metadata: {},
      createdBy: "release-admin",
      createdAt: new Date().toISOString(),
    });
    const input = {
      dnaCandidateId: "dna_core_patch_1",
      baseBaselineId: "kernel_1_0_0",
      targetVersion: "1.1.0",
      sourceDigest: sha("patch"),
      title: "Safe patch",
      summary: "Must be approved and digest-bound.",
      scope: ["api/core/runtime.ts"],
      declaredEffects: [],
      testPlan: ["test"],
      rollbackPlan: ["rollback"],
      createdBy: "developer",
    };
    await expect(new CoreEvolutionService(repository, sourceProvider("dna_core_patch_1", sha("patch"), "candidate")).submit(input))
      .rejects.toMatchObject({ code: "SOURCE_INVALID" });
    await expect(new CoreEvolutionService(repository, sourceProvider("dna_core_patch_1", sha("different"))).submit(input))
      .rejects.toMatchObject({ code: "SOURCE_INVALID" });
  });

  it("does not approve a build until every required gate passes", async () => {
    const { service, candidate } = await fixture();
    await service.beginEvaluation(candidate.id, "lab");
    await service.recordGate(candidate.id, {
      gate: "compile",
      passed: true,
      evaluator: "typescript",
      summary: "Compilation passed",
      evidenceRefs: ["artifact://compile/1"],
      metrics: {},
      completedAt: new Date().toISOString(),
    }, "lab");
    await expect(service.approveForBuild(candidate.id, "reviewer")).rejects.toMatchObject({ code: "GATES_INCOMPLETE" });
  });

  it("approves only after all gates pass and preserves the audit trail", async () => {
    const { repository, service, candidate } = await fixture();
    await service.beginEvaluation(candidate.id, "lab");
    for (const gate of RequiredCorePatchGates as CorePatchGateName[]) {
      await service.recordGate(candidate.id, {
        gate,
        passed: true,
        evaluator: `gate:${gate}`,
        summary: `${gate} passed`,
        evidenceRefs: [`artifact://${gate}/1`],
        metrics: {},
        completedAt: new Date().toISOString(),
      }, "lab");
    }
    const approved = await service.approveForBuild(candidate.id, "core-reviewer");
    expect(approved.status).toBe("approved_for_build");
    const events = await repository.listEvents(candidate.id);
    expect(events.filter((event) => event.eventType === "gate_recorded")).toHaveLength(RequiredCorePatchGates.length);
    expect(events.at(-1)).toMatchObject({ previousStatus: "evaluating", nextStatus: "approved_for_build" });
  });

  it("keeps baseline and event records immutable", async () => {
    const { repository, candidate } = await fixture();
    const baseline = await repository.getBaseline("kernel_1_0_0");
    expect(baseline).toBeDefined();
    await expect(repository.insertBaseline({ ...baseline!, kernelDigest: sha("changed") })).rejects.toThrow(/immutable content/);
    const [event] = await repository.listEvents(candidate.id);
    await expect(repository.appendEvent({ ...event, actor: "attacker" })).rejects.toThrow(/immutable content/);
  });
});
