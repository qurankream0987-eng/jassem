/** Orchestrates static review, isolated tests, signing, binding and DNA activation. */

import type { KeyLike } from "node:crypto";
import {
  SandboxResourcePolicySchema,
  type CapabilityTestCase,
  type SandboxResourcePolicy,
  type SignedCapabilityBinding,
} from "@contracts/capability-sandbox";
import type { CapabilityPackageBundle, PackageRuntime } from "@contracts/capability-package";
import type { GeneVersion } from "@contracts/generative-dna";
import type { CapabilityPackageBuilder } from "./capability-package";
import type { StaticCapabilityPackageEvaluator } from "./capability-package-evaluator";
import type { CapabilityPackageSigner } from "./capability-package-signing";
import type { CapabilitySandboxProvider } from "./capability-sandbox-provider";
import type { GenerativeDNAService } from "./generative-dna-service";
import type { SignedCapabilityBinder } from "./signed-capability-binder";
import type { CapabilityReleaseRepository } from "./capability-release-repository";

type SigningKey = KeyLike | string | Buffer;

export interface ReleaseCapabilityInput {
  candidateId: string;
  publisher: string;
  packageId?: string;
  version?: string;
  runtime?: PackageRuntime;
  entrypoint?: string;
  exportName?: string;
  testCases: CapabilityTestCase[];
  policy?: Partial<SandboxResourcePolicy>;
  canary?: boolean;
  parentVersionIds?: string[];
}

export interface ReleasedCapability {
  bundle: CapabilityPackageBundle;
  binding: SignedCapabilityBinding;
  version: GeneVersion;
}

export class CapabilityReleaseService {
  constructor(
    private readonly dna: GenerativeDNAService,
    private readonly builder: CapabilityPackageBuilder,
    private readonly staticEvaluator: StaticCapabilityPackageEvaluator,
    private readonly sandbox: CapabilitySandboxProvider,
    private readonly signer: CapabilityPackageSigner,
    private readonly binder: SignedCapabilityBinder,
    private readonly signingKey: SigningKey,
    private readonly signingKeyId: string,
    private readonly releases?: CapabilityReleaseRepository,
  ) {}

  async release(input: ReleaseCapabilityInput): Promise<ReleasedCapability> {
    const candidate = await this.dna.getCandidate(input.candidateId);
    if (!candidate) throw new Error("DNA candidate not found");
    if (candidate.status !== "approved" || candidate.proposal.kind !== "capability") {
      throw new Error("Only an approved capability candidate can receive an execution release");
    }
    const capabilityId = candidate.proposal.executorRef;
    if (!capabilityId?.startsWith("package:")) throw new Error("Capability executor must use the package namespace");
    const policy = SandboxResourcePolicySchema.parse(input.policy ?? {});
    const bundle = await this.builder.build(candidate, {
      packageId: input.packageId,
      version: input.version,
      runtime: input.runtime,
      entrypoint: input.entrypoint,
      exportName: input.exportName,
      publisher: input.publisher,
    });
    const staticEvaluation = await this.staticEvaluator.evaluate(bundle);
    if (!staticEvaluation.passed) throw new Error("Capability package failed static security evaluation");
    bundle.envelope.evaluation = staticEvaluation;
    const isolatedEvaluation = await this.sandbox.evaluate(bundle, input.testCases, policy);
    if (!isolatedEvaluation.passed || !isolatedEvaluation.eligibleForExecutionRelease || !isolatedEvaluation.executionPerformed) {
      throw new Error("Capability package failed isolated execution evaluation");
    }
    bundle.envelope.evaluation = isolatedEvaluation;
    const signed = this.signer.sign(bundle, this.signingKey, { keyId: this.signingKeyId, scope: "execution_release" });
    const canary = input.canary ?? true;
    const binding = this.binder.bind({
      bundle: signed,
      capabilityId,
      createdBy: input.publisher,
      // Bind disabled first. It becomes discoverable only after DNA activation
      // has completed, closing the release/activation race window.
      status: "canary",
      resourcePolicy: policy,
    });
    const release = { bindingId: binding.id, packageDigest: binding.packageDigest, capabilityId };
    try {
      await this.releases?.save(binding, signed.envelope);
      await this.dna.authorizeCapabilityRelease(candidate.id, release);
      const version = await this.dna.activateCandidate(candidate.id, input.publisher, {
        version: input.version,
        canary,
        parentVersionIds: input.parentVersionIds,
        executionRelease: release,
      });
      const attached = this.binder.attachGeneVersion(binding.id, version.id);
      const activatedBinding = canary ? attached : this.binder.promote(binding.id);
      await this.releases?.updateBinding(activatedBinding);
      return { bundle: signed, binding: activatedBinding, version };
    } catch (error) {
      this.binder.unbind(binding.id);
      await this.releases?.delete(binding.id).catch(() => undefined);
      throw error;
    }
  }

  async promote(bindingId: string): Promise<{ binding: SignedCapabilityBinding; version: GeneVersion }> {
    const binding = this.binder.get(bindingId);
    if (!binding?.geneVersionId || binding.status !== "canary") throw new Error("Capability canary binding not found");
    const version = await this.dna.promoteCanary(binding.geneVersionId);
    const promoted = this.binder.promote(bindingId);
    try {
      await this.releases?.updateBinding(promoted);
      return { binding: promoted, version };
    } catch (error) {
      // DNA promotion is append-only. If durable binding activation fails, keep
      // the executor disabled; hydration will also reject the status mismatch.
      const disabled = this.binder.disable(bindingId);
      await this.releases?.updateBinding(disabled).catch(() => undefined);
      throw error;
    }
  }
}
